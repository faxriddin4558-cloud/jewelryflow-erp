"use client";

import React, { useState } from "react";
import { generateQrMatrix, renderMatrixToSvg } from "@/lib/qr-generator";
import {
  generateBarTenderCsv,
  type JewelryModelItem,
  formatGrams,
} from "@/lib/barcode-scanner-engine";

interface Props {
  models: JewelryModelItem[];
  onAddModel: (model: {
    model_code: string;
    name: string;
    category: string;
    decorations?: string;
    reference_weight_grams?: number;
    gold_purity?: number;
  }) => Promise<void>;
  isBusy?: boolean;
}

export function BarTenderModelManager({ models, onAddModel, isBusy }: Props) {
  const [selectedModel, setSelectedModel] = useState<JewelryModelItem | null>(
    models.length > 0 ? (models[0] ?? null) : null
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  // New model form states
  const [newCode, setNewCode] = useState(`JF-M-000${models.length + 1}`);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Серьги");
  const [newDecorations, setNewDecorations] = useState("Дорика");
  const [newWeight, setNewWeight] = useState("14.50");
  const [newPurity, setNewPurity] = useState("585");

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
    if (!newCode.trim() || !newName.trim()) return;

    await onAddModel({
      model_code: newCode.trim().toUpperCase(),
      name: newName.trim(),
      category: newCategory.trim(),
      decorations: newDecorations.trim() || undefined,
      reference_weight_grams: parseFloat(newWeight) || undefined,
      gold_purity: parseInt(newPurity, 10) || 585,
    });

    setShowAddModal(false);
    setNewName("");
    setNewCode(`JF-M-000${models.length + 2}`);
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
            onClick={() => setShowAddModal(true)}
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
                  <th className="py-3 px-4">Model Kodi</th>
                  <th className="py-3 px-4">Nomi</th>
                  <th className="py-3 px-4">Kategoriya</th>
                  <th className="py-3 px-4">Proba</th>
                  <th className="py-3 px-4">Bezak</th>
                  <th className="py-3 px-4">Standart Vazn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {models.map((m) => {
                  const isSelected = selectedModel?.id === m.id;
                  return (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedModel(m)}
                      className={`cursor-pointer transition ${
                        isSelected
                          ? "bg-amber-500/15 text-white border-l-4 border-amber-400 font-bold"
                          : "hover:bg-slate-900/50 text-slate-300"
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-amber-300">{m.model_code}</td>
                      <td className="py-3 px-4 font-semibold text-white">{m.name}</td>
                      <td className="py-3 px-4">{m.category || "Серьги"}</td>
                      <td className="py-3 px-4 font-mono">{m.gold_purity || 585}°</td>
                      <td className="py-3 px-4">{m.decorations || "Standart"}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {m.reference_weight_grams ? `~${formatGrams(m.reference_weight_grams)} g` : "—"}
                      </td>
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
                className="bg-white text-slate-900 rounded-2xl p-5 space-y-3 shadow-lg border border-slate-300 flex flex-col items-center"
              >
                <div className="text-xs uppercase font-extrabold tracking-widest text-slate-600">
                  GOLDIA JEWELRY
                </div>

                <div
                  className="bg-white p-2 rounded-xl border border-slate-200"
                  dangerouslySetInnerHTML={{ __html: activeQrSvg }}
                />

                <div className="space-y-1 text-center font-sans">
                  <div className="font-mono text-base font-black text-slate-950 tracking-wider">
                    {selectedModel.model_code}
                  </div>
                  <div className="font-bold text-sm text-slate-800">{selectedModel.name}</div>
                  <div className="text-xs text-slate-500">
                    {selectedModel.category || "Серьги"} • {selectedModel.decorations || "Standart"} • {selectedModel.gold_purity || 585}°
                  </div>
                  {selectedModel.reference_weight_grams && (
                    <div className="text-xs text-slate-600 font-mono">
                      Mo&apos;ljal: ~{formatGrams(selectedModel.reference_weight_grams)} g
                    </div>
                  )}
                </div>

                {/* Existing Linear Barcode Mockup */}
                <div className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-xl p-2.5 text-center">
                  <div className="text-[10px] text-slate-500 font-semibold mb-1">
                    Mavjud Chiziqli Vazn Shtrix-Kodi (O&apos;zgarmaydi):
                  </div>
                  <div className="font-mono text-xs tracking-widest text-slate-800 font-black bg-white p-1.5 rounded-lg border border-slate-200">
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

            <form onSubmit={handleSubmitNewModel} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-300">Model Kodi (BarTender QR uchun):</label>
                <input
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder="Masalan: JF-M-0001"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Model Nomi:</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Masalan: Malika, Shahzoda, Italiya Uzuk"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Kategoriya:</label>
                  <select
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
                    type="text"
                    value={newDecorations}
                    onChange={(e) => setNewDecorations(e.target.value)}
                    placeholder="Masalan: Дорика, Fasion"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Standart Vazn (g):</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newWeight}
                    onChange={(e) => setNewWeight(e.target.value)}
                    placeholder="Masalan: 14.50"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
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
