"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";

interface CleanableItem {
  receipt_id: string;
  receipt_no: string;
  product_name: string;
  physical_g: number;
  obligation_g: number;
  status: string;
}

interface BlockedItem {
  receipt_id: string;
  receipt_no: string;
  product_name: string;
  blocked_reason: string;
}

interface CleanupPreview {
  preview_token: string;
  cleanable_items: CleanableItem[];
  blocked_items: BlockedItem[];
  summary: {
    cleanable_count: number;
    blocked_count: number;
    inventory_reduction_585_g: number;
    factory_obligation_reduction_g: number;
  };
}

export function TestCleanupSection() {
  const [currentRole, setCurrentRole] = useState<string>("seller");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [executingCleanup, setExecutingCleanup] = useState(false);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>([]);
  const [confirmCode, setConfirmCode] = useState("");
  const [cleanupReason, setCleanupReason] = useState("");
  const [resultMessage, setResultMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    supabase.rpc("current_employee_role_text").then(({ data }) => {
      if (data) setCurrentRole(String(data).toLowerCase());
    });
  }, []);

  const isPrivileged = [
    "admin", "director", "owner", "direktor", "rahbar"
  ].includes(currentRole);

  const handleFetchPreview = async () => {
    setLoadingPreview(true);
    setResultMessage(null);
    try {
      const { data, error } = await supabase.rpc("rpc_preview_selective_test_cleanup");
      if (error) throw error;
      setPreview(data as CleanupPreview);
      // By default select all cleanable items
      if (data?.cleanable_items) {
        setSelectedReceiptIds(data.cleanable_items.map((i: CleanableItem) => i.receipt_id));
      }
    } catch (err: unknown) {
      setResultMessage({
        type: "error",
        text: `Sinov ma'lumotlarini tekshirishda xatolik: ${parseErrorMessage(err, "Tekshirib bo'lmadi")}`,
      });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleExecuteCleanup = async () => {
    if (confirmCode.trim() !== "CONFIRM_TEST_CLEANUP_2026") {
      setResultMessage({
        type: "error",
        text: "Tasdiqlash kodi noto'g'ri! Iltimos, aynan CONFIRM_TEST_CLEANUP_2026 deb yozing.",
      });
      return;
    }

    if (!cleanupReason.trim()) {
      setResultMessage({
        type: "error",
        text: "Sinov partiyalarini tozalash sababini kiritishingiz shart!",
      });
      return;
    }

    if (selectedReceiptIds.length === 0) {
      setResultMessage({
        type: "error",
        text: "Kamida bitta tozalanadigan partiyani tanlang.",
      });
      return;
    }

    setExecutingCleanup(true);
    setResultMessage(null);
    try {
      const { data, error } = await supabase.rpc("rpc_execute_selective_test_cleanup", {
        p_receipt_ids: selectedReceiptIds,
        p_confirmation_code: confirmCode.trim(),
        p_reason: cleanupReason.trim(),
      });
      if (error) throw error;

      setResultMessage({
        type: "success",
        text: `Muvaffaqiyatli tozalandi! ${data?.message || ""} Jami kamaytirilgan zavod qarzi: ${formatScreenGrams(data?.total_deducted_obligation_g || 0)} g.`,
      });
      setPreview(null);
      setConfirmCode("");
      setCleanupReason("");
      setSelectedReceiptIds([]);
    } catch (err: unknown) {
      setResultMessage({
        type: "error",
        text: `Tozalashda xatolik: ${parseErrorMessage(err, "Tozalab bo'lmadi")}`,
      });
    } finally {
      setExecutingCleanup(false);
    }
  };

  const toggleReceiptSelect = (id: string) => {
    setSelectedReceiptIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  if (!isPrivileged) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h3 className="text-base font-bold text-amber-300">Ruxsat Cheklangan</h3>
        <p className="text-xs text-slate-400 mt-1">
          Sinov ma&apos;lumotlarini tozalash vositasi faqat korxona direktori va admin uchun ochiq.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-rose-950/40 to-slate-900 border border-rose-900/40 rounded-3xl p-6 text-white space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-rose-300 flex items-center gap-2">
              <span>🧹</span> Sinov Ma&apos;lumotlarini Xavfsiz Tozalash (Selective Cleanup)
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Tizimni pilot va real ishlab chiqarishga tayyorlashda kiritilgan sinov zavod partiyalarini
              audited bekor qilish orqali xavfsiz tozalash. Akkauntlar, xodimlar, mijoz kartochkalari, modellar
              va sozlamalar 100% tegilmasdan saqlanadi.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleFetchPreview()}
            disabled={loadingPreview || executingCleanup}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 transition flex items-center gap-2 disabled:opacity-50"
          >
            {loadingPreview ? (
              <span>⏳ Tekshirilmoqda...</span>
            ) : (
              <>
                <span>🔍</span> Sinov Partiyalarini Tekshirish (Preview)
              </>
            )}
          </button>
        </div>

        {/* Safety Guarantees Notice */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
          <div className="flex items-start gap-2">
            <span className="text-emerald-400 font-bold">✓</span>
            <span className="text-slate-300">
              <strong>TRUNCATE qilinmaydi:</strong> Barcha jadvallar butun saqlanadi, faqat tanlangan partiyalar bekor qilinadi.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-400 font-bold">✓</span>
            <span className="text-slate-300">
              <strong>Zanjir tekshiruvi:</strong> Agar tovar sotilgan yoki tarqatilgan bo&apos;lsa, tizim o&apos;chirishni bloklaydi.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-400 font-bold">✓</span>
            <span className="text-slate-300">
              <strong>Ixtiyoriy nazorat:</strong> Release vaqtida avtomatik o&apos;chirilmaydi, direktor xohlagan paytda boshqaradi.
            </span>
          </div>
        </div>
      </div>

      {resultMessage && (
        <div
          className={`p-4 rounded-2xl text-xs font-bold border ${
            resultMessage.type === "success"
              ? "bg-emerald-950/80 border-emerald-700 text-emerald-200"
              : "bg-rose-950/80 border-rose-700 text-rose-200"
          }`}
        >
          {resultMessage.text}
        </div>
      )}

      {/* Preview Results Display */}
      {preview && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <span>📋</span> Aniqlangan Sinov Partiyalari Xulosasi
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              Token: {preview.preview_token}
            </span>
          </div>

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
              <span className="text-[11px] text-slate-400 block">Tozalanadigan Partiyalar:</span>
              <strong className="text-lg font-black text-rose-400">
                {preview.summary.cleanable_count} ta
              </strong>
            </div>
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
              <span className="text-[11px] text-slate-400 block">Bloklangan (Sotilgan):</span>
              <strong className="text-lg font-black text-amber-400">
                {preview.summary.blocked_count} ta
              </strong>
            </div>
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
              <span className="text-[11px] text-slate-400 block">Ombor Kamayishi (585g):</span>
              <strong className="text-lg font-black text-white font-mono">
                -{formatScreenGrams(preview.summary.inventory_reduction_585_g)}
              </strong>
            </div>
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
              <span className="text-[11px] text-slate-400 block">Zavod Qarzi Kamayishi:</span>
              <strong className="text-lg font-black text-emerald-400 font-mono">
                -{formatScreenGrams(preview.summary.factory_obligation_reduction_g)}
              </strong>
            </div>
          </div>

          {/* Cleanable Items Table */}
          {preview.cleanable_items.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-300">
                Tozalanishi Mumkin Bo&apos;lgan Partiyalar ({preview.cleanable_items.length})
              </h4>
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 text-center">Tanlash</th>
                      <th className="py-2.5 px-3">Kvitansiya №</th>
                      <th className="py-2.5 px-3">Mahsulot Nomi</th>
                      <th className="py-2.5 px-3 font-mono text-right">Mavjud Vazn (g)</th>
                      <th className="py-2.5 px-3 font-mono text-right text-emerald-400">Zavod Majburiyati (g)</th>
                      <th className="py-2.5 px-3 text-center">Holati</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {preview.cleanable_items.map((item) => (
                      <tr key={item.receipt_id} className="hover:bg-slate-900/40">
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={selectedReceiptIds.includes(item.receipt_id)}
                            onChange={() => toggleReceiptSelect(item.receipt_id)}
                            className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 bg-slate-900 border-slate-700"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-400">
                          {item.receipt_no}
                        </td>
                        <td className="py-2.5 px-3 text-white font-bold">{item.product_name}</td>
                        <td className="py-2.5 px-3 font-mono text-right text-white">
                          {formatScreenGrams(item.physical_g)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-right text-emerald-400 font-bold">
                          {formatScreenGrams(item.obligation_g)}
                        </td>
                        <td className="py-2.5 px-3 text-center text-[10px] text-slate-400">
                          {item.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Blocked Items (if any) */}
          {preview.blocked_items.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <span>⚠️</span> O&apos;chirib Bo&apos;lmaydigan Partiyalar (Bog&apos;liq Sotuvlar Mavjud)
              </h4>
              <div className="space-y-1.5">
                {preview.blocked_items.map((item) => (
                  <div
                    key={item.receipt_id}
                    className="p-3 bg-amber-950/30 border border-amber-800/60 rounded-xl text-xs flex justify-between items-center"
                  >
                    <div>
                      <strong className="text-amber-300 font-mono">{item.receipt_no}</strong> —{" "}
                      <span className="text-white">{item.product_name}</span>
                    </div>
                    <span className="text-amber-200/90 text-[11px]">{item.blocked_reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Execution Form */}
          {preview.cleanable_items.length > 0 && (
            <div className="bg-slate-950 p-5 rounded-2xl border border-rose-900/50 space-y-4">
              <h4 className="text-xs font-black text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🔐</span> Tozalashni Tasdiqlash
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Tasdiqlash Kodi: <span className="text-rose-400 font-mono">CONFIRM_TEST_CLEANUP_2026</span>
                  </label>
                  <input
                    type="text"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    placeholder="CONFIRM_TEST_CLEANUP_2026"
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-white focus:ring-2 focus:ring-rose-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Tozalash Sababi / Asos:
                  </label>
                  <input
                    type="text"
                    value={cleanupReason}
                    onChange={(e) => setCleanupReason(e.target.value)}
                    placeholder="Masalan: Pilot oldidan 165g sinov partiyasini tozalash"
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-rose-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => void handleExecuteCleanup()}
                  disabled={executingCleanup || selectedReceiptIds.length === 0}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-xs rounded-xl shadow-lg shadow-rose-600/30 transition flex items-center gap-2"
                >
                  {executingCleanup ? (
                    <span>⏳ Tozalanmoqda...</span>
                  ) : (
                    <>
                      <span>⚠️</span> Tanlangan {selectedReceiptIds.length} ta Partiyani Tozalash (Bekor Qilish)
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
