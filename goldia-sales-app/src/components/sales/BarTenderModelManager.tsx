"use client";

import React, { useState, useRef } from "react";
import { generateQrMatrix, renderMatrixToSvg } from "@/lib/qr-generator";
import {
  generateBarTenderCsv,
  type JewelryModelItem,
} from "@/lib/barcode-scanner-engine";
import { validateImageFile, compressImageFile } from "@/lib/image-compression";
import { ModelPhotoThumbnail } from "./ModelPhotoThumbnail";

interface Props {
  models: JewelryModelItem[];
  onAddModel: (model: {
    model_code?: string;
    name: string;
    category: string;
    decorations?: string;
    reference_weight_grams?: number;
    gold_purity?: number;
    primary_image_url?: string;
  }) => Promise<JewelryModelItem | void>;
  onUpdateModelPhoto?: (modelId: string, photoUrl: string) => Promise<void>;
  isBusy?: boolean;
}

export function BarTenderModelManager({ models = [], onAddModel, onUpdateModelPhoto, isBusy }: Props) {
  const safeModels = models || [];
  const [selectedModel, setSelectedModel] = useState<JewelryModelItem | null>(
    safeModels.length > 0 ? (safeModels[0] ?? null) : null
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // New model form states
  const nextSeqCode = `JF-M-${String(safeModels.length + 1).padStart(4, "0")}`;
  const [newCode, setNewCode] = useState(nextSeqCode);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Серьги");
  const [newDecorations, setNewDecorations] = useState("Дорика");
  const [newPurity, setNewPurity] = useState("585");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUpdatingPhoto, setIsUpdatingPhoto] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editPhotoInputRef = useRef<HTMLInputElement>(null);

  // Keep selection valid as models array updates
  React.useEffect(() => {
    const list = models || [];
    if (!selectedModel && list.length > 0) {
      setSelectedModel(list[0] ?? null);
    } else if (selectedModel && list.length > 0) {
      const match = list.find(m => m.id === selectedModel.id || m.model_code === selectedModel.model_code);
      if (match) setSelectedModel(match);
    }
  }, [models, selectedModel]);

  const handleOpenAddModal = () => {
    const list = models || [];
    setNewCode(`JF-M-${String(list.length + 1).padStart(4, "0")}`);
    setFormError(null);
    setPhotoPreview(null);
    setShowAddModal(true);
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFormError(null);
    const valResult = validateImageFile(file);
    if (!valResult.valid) {
      setFormError(valResult.error || "Rasm fayli yaroqsiz!");
      return;
    }

    try {
      setIsCompressing(true);
      const compressed = await compressImageFile(file, 800, 0.82);
      setPhotoPreview(compressed.dataUrl);
    } catch {
      setFormError("Rasmni siqishda xatolik yuz berdi");
    } finally {
      setIsCompressing(false);
    }
  };

  const handleEditExistingModelPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedModel || !onUpdateModelPhoto) return;

    const valResult = validateImageFile(file);
    if (!valResult.valid) {
      alert(valResult.error || "Rasm fayli yaroqsiz!");
      return;
    }

    try {
      setIsUpdatingPhoto(true);
      const compressed = await compressImageFile(file, 800, 0.82);
      const res = await fetch("/api/models/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl: compressed.dataUrl,
          modelCode: selectedModel.model_code,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.error || "Rasmni yuklashda xatolik");
      }
      await onUpdateModelPhoto(selectedModel.id, json.url);
      setSelectedModel({ ...selectedModel, primary_image_url: json.url });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Rasm yangilashda xatolik: ${msg}`);
    } finally {
      setIsUpdatingPhoto(false);
      if (editPhotoInputRef.current) editPhotoInputRef.current.value = "";
    }
  };

  const handleDownloadCsv = () => {
    const csvContent = generateBarTenderCsv(models);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `bartender_jewelry_models_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintTag = () => {
    window.print();
  };

  const handleSubmitNewModel = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!newName.trim()) {
      setFormError("Model nomi kiritilishi shart!");
      return;
    }

    try {
      let uploadedPhotoUrl: string | undefined = undefined;

      if (photoPreview) {
        const res = await fetch("/api/models/photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataUrl: photoPreview,
            modelCode: newCode.trim() || "MODEL",
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.url) {
          throw new Error(json.error || "Rasmni yuklashda server xatosi");
        }
        uploadedPhotoUrl = json.url;
      }

      const created = await onAddModel({
        model_code: newCode.trim() ? newCode.trim().toUpperCase() : undefined,
        name: newName.trim(),
        category: newCategory.trim(),
        decorations: newDecorations.trim() || undefined,
        gold_purity: parseInt(newPurity, 10) || 585,
        primary_image_url: uploadedPhotoUrl,
      });

      setShowAddModal(false);
      setNewName("");
      setNewDecorations("");
      setPhotoPreview(null);
      setNewCode(`JF-M-${String(models.length + 2).padStart(4, "0")}`);
      if (created) {
        setSelectedModel(created);
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // QR SVG for active model
  const activeQrSvg = selectedModel
    ? renderMatrixToSvg(generateQrMatrix(selectedModel.model_code), 160)
    : "";

  return (
    <div className="space-y-6">
      {/* Top Banner & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-3xl text-white">
        <div>
          <h2 className="text-xl font-black text-amber-300 flex items-center gap-2">
            <span>🏷️</span> BarTender Modellar Boshqaruvi va QR Generatori
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Zavod BarTender shabloniga ulanadigan doimiy model kodlari (JF-M-xxxx) va bosmaga chiqariladigan QR kartochkalar
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowGuideModal(true)}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 transition"
          >
            <span>📖</span> BarTender Qo&apos;llanmasi
          </button>
          <button
            id="exportBartenderCsvBtn"
            onClick={handleDownloadCsv}
            className="px-3.5 py-2 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-xs font-bold rounded-xl border border-emerald-800 flex items-center gap-1.5 transition"
          >
            <span>📥</span> BarTender uchun CSV
          </button>
          <button
            id="openAddModelModalBtn"
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl transition flex items-center gap-1.5 shadow-md"
          >
            <span>+</span> Yangi Model Qo&apos;shish
          </button>
        </div>
      </div>

      {/* Main Grid: Models List & QR Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Models Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
              Doimiy Modellar Ro&apos;yxati ({models.length})
            </h3>
            <span className="text-xs text-slate-500">QR kodni ko&apos;rish uchun modelni bosing</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3">Rasm</th>
                  <th className="py-3 px-4">Model Kodi</th>
                  <th className="py-3 px-4">Nomi</th>
                  <th className="py-3 px-4">Kategoriya</th>
                  <th className="py-3 px-4">Proba</th>
                  <th className="py-3 px-4">Bezak</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {models.map((m) => {
                  const isSelected = selectedModel?.id === m.id || selectedModel?.model_code === m.model_code;
                  return (
                    <tr
                      key={m.id}
                      id={`model-row-${m.model_code}`}
                      data-testid={`model-row-${m.model_code}`}
                      onClick={() => setSelectedModel(m)}
                      className={`cursor-pointer transition ${
                        isSelected
                          ? "bg-amber-500/15 text-white border-l-4 border-amber-400 font-bold"
                          : "hover:bg-slate-900/50 text-slate-300"
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <ModelPhotoThumbnail
                          src={m.primary_image_url}
                          alt={m.name}
                          size="xs"
                          rounded="md"
                        />
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-amber-300">{m.model_code}</td>
                      <td className="py-3 px-4 font-semibold text-white">{m.name}</td>
                      <td className="py-3 px-4">{m.category || "Серьги"}</td>
                      <td className="py-3 px-4 font-mono">{m.gold_purity || 585}°</td>
                      <td className="py-3 px-4">{m.decorations || "Standart"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Printable QR Tag Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
              BarTender QR Teg Namunasi
            </h3>

            {selectedModel ? (
              <div
                id="printableQrCard"
                className="bg-white text-[#0F172A] rounded-2xl p-5 space-y-3 shadow-lg border border-slate-300 flex flex-col items-center"
              >
                <div className="text-xs uppercase font-extrabold tracking-widest text-[#475569]">
                  GOLDIA JEWELRY
                </div>

                {/* Model Primary Photo */}
                <div className="flex flex-col items-center gap-2 my-1">
                  <ModelPhotoThumbnail
                    src={selectedModel.primary_image_url}
                    alt={selectedModel.name}
                    size="lg"
                    rounded="xl"
                  />
                  <input
                    ref={editPhotoInputRef}
                    id="editModelPhotoInput"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="hidden"
                    onChange={handleEditExistingModelPhoto}
                  />
                  {onUpdateModelPhoto && (
                    <button
                      type="button"
                      id="editModelPhotoBtn"
                      onClick={() => editPhotoInputRef.current?.click()}
                      disabled={isUpdatingPhoto}
                      className="text-[10px] text-amber-800 hover:text-amber-950 font-bold bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-lg transition flex items-center gap-1 shadow-sm"
                    >
                      <span>📷</span>
                      <span>{isUpdatingPhoto ? "Yuklanmoqda..." : "Rasm qo'shish / almashtirish"}</span>
                    </button>
                  )}
                </div>

                <div
                  id="activeCardQrSvg"
                  className="bg-white p-2 rounded-xl border border-slate-200"
                  dangerouslySetInnerHTML={{ __html: activeQrSvg }}
                />

                <div className="space-y-1 text-center font-sans">
                  <div id="activeCardModelCode" className="font-mono text-base font-black text-[#0F172A] tracking-wider">
                    {selectedModel.model_code}
                  </div>
                  <div id="activeCardModelName" className="font-bold text-sm text-[#0F172A]">{selectedModel.name}</div>
                  <div className="text-xs text-[#475569]">
                    {selectedModel.category || "Серьги"} • {selectedModel.decorations || "Standart"} • {selectedModel.gold_purity || 585}°
                  </div>
                </div>

                {/* Existing Linear Barcode Mockup */}
                <div className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-xl p-2.5 text-center">
                  <div className="text-[10px] text-[#475569] font-semibold mb-1">
                    Mavjud Chiziqli Vazn Shtrix-Kodi (O&apos;zgarmaydi):
                  </div>
                  <div className="font-mono text-xs tracking-widest text-[#0F172A] font-black bg-white p-1.5 rounded-lg border border-slate-200">
                    ||| | |||| | ||| |||| | 14.52 |||
                  </div>
                  <div className="text-[10px] text-emerald-700 font-medium mt-1">
                    ✓ Asl vazn shtrix-kodi saqlanadi, faqat QR qo&apos;shiladi
                  </div>
                </div>

                <div className="text-[10px] text-center text-amber-800 bg-amber-50 p-2 rounded-xl border border-amber-200 w-full leading-tight">
                  <strong>Eslatma:</strong> Zavodning original BarTender shablonini o&apos;chirib yubormang! Avval fayldan nusxa (backup) oling va mahalliy printerda chop etib sinab ko&apos;ring.
                </div>
              </div>
            ) : (
              <div className="bg-slate-950 rounded-2xl p-8 text-center text-xs text-slate-500">
                Model tanlanmagan
              </div>
            )}
          </div>

          {selectedModel && (
            <button
              onClick={handlePrintTag}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition"
            >
              <span>🖨️</span> Model QR Kartochkasini Chop Etish (Print)
            </button>
          )}
        </div>
      </div>

      {/* Modal: Add New Model */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full text-white space-y-5 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-amber-300">Yangi Doimiy Model Qo&apos;shish</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div id="modelFormErrorAlert" className="bg-rose-950/80 border border-rose-700 text-rose-200 px-3.5 py-2.5 rounded-xl text-xs flex items-center justify-between">
                <span>⚠️ {formError}</span>
                <button type="button" onClick={() => setFormError(null)} className="text-rose-400 font-bold ml-2">✕</button>
              </div>
            )}

            <form onSubmit={handleSubmitNewModel} className="space-y-4 text-xs">
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-slate-300">Model Kodi (BarTender QR uchun):</label>
                  <span className="text-[10px] text-amber-300">Server ketma-ketlikda ta&apos;minlaydi</span>
                </div>
                <input
                  id="newModelCode"
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder="Avtomatik (masalan: JF-M-0002)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Model Nomi:</label>
                <input
                  id="newModelName"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Masalan: Zarina, Shahzoda, Italiya Uzuk"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Kategoriya:</label>
                  <select
                    id="newModelCategory"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="Серьги">Серьги (Sirg&apos;a)</option>
                    <option value="Кольцо">Кольцо (Uzuk)</option>
                    <option value="Цепь">Цепь (Zanjir)</option>
                    <option value="Браслет">Браслет (Bilaguzuk)</option>
                    <option value="Кулон">Кулон (Pendant)</option>
                    <option value="Комплект">Комплект (To&apos;plam)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Proba:</label>
                  <select
                    id="newModelPurity"
                    value={newPurity}
                    onChange={(e) => setNewPurity(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="585">585</option>
                    <option value="750">750</option>
                    <option value="916">916</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Bezak (Decorations):</label>
                  <input
                    id="newModelDecorations"
                    type="text"
                    value={newDecorations}
                    onChange={(e) => setNewDecorations(e.target.value)}
                    placeholder="Masalan: Дорика, Fasion"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              {/* Product Photo Upload Field */}
              <div className="space-y-1.5 pt-1 border-t border-slate-800">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-slate-300">
                    Model Rasmi (Ixtiyoriy — Kamera yoki Fayl):
                  </label>
                  {isCompressing && (
                    <span className="text-[10px] text-amber-400 animate-pulse">
                      Rasm siqilmoqda...
                    </span>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  id="newModelPhotoInput"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />

                {photoPreview ? (
                  <div className="flex items-center gap-3 bg-slate-950 p-2.5 rounded-2xl border border-slate-700">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoPreview}
                      alt="Tanlangan rasm"
                      className="w-14 h-14 object-cover rounded-xl border border-amber-400/60 shadow-sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-emerald-400 font-bold text-xs truncate">
                        ✓ Rasm yuklashga tayyor
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Tezkor yuklanish uchun avtomatik siqildi (WebP / 800px)
                      </div>
                    </div>
                    <button
                      type="button"
                      id="removePhotoBtn"
                      onClick={() => setPhotoPreview(null)}
                      className="text-xs text-rose-400 hover:text-rose-300 bg-rose-950/60 border border-rose-800 px-2 py-1 rounded-lg"
                    >
                      O&apos;chirish
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      id="choosePhotoFileBtn"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 py-2.5 px-3 bg-slate-950 hover:bg-slate-800 border border-dashed border-slate-700 hover:border-amber-400 rounded-xl text-slate-300 hover:text-white transition flex items-center justify-center gap-2"
                    >
                      <span>📷</span>
                      <span>Kameradan olish yoki Fayl tanlash</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl"
                >
                  Bekor Qilish
                </button>
                <button
                  id="submitNewModelBtn"
                  type="submit"
                  disabled={isBusy}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl"
                >
                  {isBusy ? "Saqlanmoqda..." : "Saqlash"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: BarTender Setup Guide */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-2xl w-full text-white space-y-5 shadow-2xl my-8">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                <span>📖</span> BarTender Shabloniga QR Kodni Bog&apos;lash Qo&apos;llanmasi
              </h3>
              <button
                onClick={() => setShowGuideModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300 leading-relaxed max-h-[70vh] overflow-y-auto pr-2">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-300 text-sm">
                  1-Qadam: CSV Ma&apos;lumotlar Bazasini Yuklab Oling
                </div>
                <p>
                  Yuqoridagi <strong>&quot;BarTender uchun CSV&quot;</strong> tugmasini bosing. Sizga{" "}
                  <code>ModelCode</code>, <code>ModelName</code>, <code>Category</code>,{" "}
                  <code>Purity</code>, <code>Decorations</code> ustunlaridan iborat fayl yuklab
                  beriladi.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-300 text-sm">
                  2-Qadam: BarTender Designer dasturida Bazani Ulash
                </div>
                <ol className="list-decimal list-inside space-y-1 pl-1">
                  <li>BarTender dasturida zavodning mavjud 585 teg shablonini oching.</li>
                  <li>
                    Menyudan <strong>File → Database Connection Setup</strong> bo&apos;limiga kiring.
                  </li>
                  <li>
                    <strong>Text File / CSV</strong> tanlang va yuklab olingan CSV faylni ko&apos;rsating.
                  </li>
                </ol>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-300 text-sm">
                  3-Qadam: Tegga 2D QR Kod Qo&apos;shish
                </div>
                <ol className="list-decimal list-inside space-y-1 pl-1">
                  <li>
                    Asboblar panelidan <strong>Barcode → 2D Barcode → QR Code</strong> ni tanlang.
                  </li>
                  <li>QR kod ustiga ikki marta bosing (Properties).</li>
                  <li>
                    Data Source turini <strong>Database Field</strong> ga o&apos;zgartiring va{" "}
                    <code>ModelCode</code> (yoki <code>QrPayload</code>) maydonini tanlang.
                  </li>
                  <li>
                    Shunday qilib, har bir zargarlik buyumi tegida uning doimiy model kodi (masalan,{" "}
                    <code>JF-M-0001</code>) QR formatda chop etiladi.
                  </li>
                </ol>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-300 text-sm">
                  4-Qadam: Chiziqli Vazn Shtrix-Kodi (Linear Barcode)
                </div>
                <p>
                  Tegdagi mavjud chiziqli shtrix-kodga tegmang! Unga hozirgidek tarozidan olingan aniq
                  vazn (masalan, <code>14.52</code>) kiritiladi.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-amber-600/40 space-y-1 text-amber-200">
                <div className="font-bold">5-Qadam: Scanner 564 bilan Ishlash Tartibi:</div>
                <p>
                  Operator dastlab tegning <strong>QR kodi</strong>ni skaner qiladi (ERP modelni
                  Malika deb aniqlaydi). Keyin esa ketma-ket har bir buyumning{" "}
                  <strong>chiziqli vazn shtrix-kodi</strong>ni o&apos;qitadi. Excel jadvalining o&apos;rnini
                  JewelryFlow avtomatik egallaydi!
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowGuideModal(false)}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs"
              >
                Tushunarli (Yopish)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
