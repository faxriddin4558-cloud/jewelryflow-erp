"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase, type SheetsImportBatchRow } from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";

interface SheetsPreviewResponse {
  success: boolean;
  sheet_name: string;
  is_opening_balance: boolean;
  summary: {
    total_rows: number;
    valid_rows: number;
    skipped_rows: number;
    total_weight_g: number;
    total_cash_amount: number;
  };
  rows: Array<{
    line_number: number;
    is_valid: boolean;
    errors: string[];
    raw: Record<string, string>;
    mapped: Record<string, unknown>;
  }>;
  column_mapping: Record<string, string>;
  error?: string;
}

const SAMPLE_CSV_TEMPLATES: Record<string, string> = {
  "Zavod bilan": `Sana,Mahsulot nomi,Sof ogirlik (g),Proba,Ustama %,Zavod qarzi (g),Izoh
2026-02-01,Zanjir Bismark,150.0000,585,8.00,162.0000,Fevral 1-partiya
2026-02-05,Uzuk Klassik,80.5000,585,8.00,86.9400,Fevral 2-partiya
2026-02-10,Sirg'a Dorika,45.2000,585,8.00,48.8160,Maxsus buyurtma`,

  "Tovar olish": `Sana,Taminotchi,Tolangan naqd pul (UZS),Gramm kursi (UZS),Olingan vazn (g),Proba,Izoh
2026-02-02,Chorsu Oltin Markazi,90000000,900000,100.0000,585,Naqdga xarid 100g
2026-02-08,Zargarlik Savdo MCHJ,45000000,900000,50.0000,585,Qoshimcha xarid`,

  "Lom pateriya": `Sana,Kirim lom (g),Erigan vazn (g),Chiqish sof oltin (g),Sof proba,Pateriya (g),Izoh
2026-02-03,200.0000,198.5000,116.8000,995,1.5000,Yanvar lomi afinaj
2026-02-12,150.0000,149.0000,87.6000,995,1.0000,Haftalik afinaj`,

  "Sanatoni sotuv": `Sana,Sotuvchi,Mahsulot / Model,Vazn (g),Proba,Mijoz ustamasi %,Mijoz ismi,Lom tolovi (g),Naqd tolovi (UZS),Izoh
2026-02-04,Jamshid Sotuvchi,JF-M-0001 Malika,25.4000,585,12.00,Akmal Zargar,15.0000,9000000,Nasiya savdo
2026-02-09,Jamshid Sotuvchi,JF-M-0002 Zarina,18.2000,585,12.00,Shohruh Toshkent,10.0000,5000000,Nasiya savdo`,

  "Otush sotuv": `Sana,Sotuvchi,Mahsulot / Model,Vazn (g),Proba,Mijoz ustamasi %,Mijoz ismi,Lom tolovi (g),Naqd tolovi (UZS),Izoh
2026-02-06,Dilshod Sotuvchi,JF-M-0001 Malika,30.0000,585,12.00,Farhod Usta,20.0000,9000000,Navoiy filiali`,

  "Buxoro sotuv": `Sana,Sotuvchi,Mahsulot / Model,Vazn (g),Proba,Mijoz ustamasi %,Mijoz ismi,Lom tolovi (g),Naqd tolovi (UZS),Izoh
2026-02-07,Jasur Sotuvchi,JF-M-0003 Dorika,42.0000,585,12.00,Bobur Buxoro,25.0000,15000000,Buxoro savdosi`,

  "opening_balances": `Sana,Turi,Nomi / Xodim,585 Lom vazn (g),Naqd summa (UZS),Zavod qarzi (g),Bozor qarzi (g),Izoh
2026-01-01,Zavod qarzi,Zavod Bosh Qarzi,0,0,108.0000,0,Boshlangich zavod majburiyati
2026-01-01,Sotuvchi qarzi,Jamshid Sotuvchi,0,0,0,-15.5000,Jamshid boshlangich bozor qarzi
2026-01-01,Mijoz qarzi,Akmal Zargar,22.0000,0,0,0,Akmal zargar nasiya qoldigi
2026-01-01,Kassa qoldigi,Boshqaruvchi kassasi,45.2000,18000000,0,0,Menejer kassa qoldigi`,
};

export function SheetsImportSection() {
  const [sheetName, setSheetName] = useState<string>("Zavod bilan");
  const [csvText, setCsvText] = useState<string>("");
  const [isOpeningBalance, setIsOpeningBalance] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [preview, setPreview] = useState<SheetsPreviewResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [batches, setBatches] = useState<SheetsImportBatchRow[]>([]);

  const loadBatches = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("sheets_import_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (data) {
        setBatches(data as SheetsImportBatchRow[]);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const handleLoadSample = () => {
    const sample = SAMPLE_CSV_TEMPLATES[sheetName] || "";
    setCsvText(sample);
    setPreview(null);
    setStatusMessage({ type: "success", text: `"${sheetName}" uchun namuna ma'lumotlari yuklandi!` });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvText(content || "");
      setPreview(null);
      setStatusMessage({ type: "success", text: `Fayl yuklandi: ${file.name} (${file.size} bayt)` });
    };
    reader.onerror = () => {
      setStatusMessage({ type: "error", text: "Faylni o'qishda xatolik yuz berdi" });
    };
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    if (!csvText.trim()) {
      setStatusMessage({ type: "error", text: "Iltimos, CSV matnini kiriting yoki fayl yuklang!" });
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch("/api/sales/import/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          sheet_name: sheetName,
          csv_text: csvText,
          is_opening_balance: isOpeningBalance,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusMessage({ type: "error", text: data.error || "CSV ma'lumotlarini tahlil qilishda xatolik" });
        setPreview(null);
      } else {
        setPreview(data as SheetsPreviewResponse);
        setStatusMessage({
          type: "success",
          text: `Tahlil tugadi: Jami ${data.summary.total_rows} ta qatordan ${data.summary.valid_rows} tasi to'g'ri, ${data.summary.skipped_rows} tasi xato/o'tkazib yuborildi.`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Tahlil xatosi: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!csvText.trim()) return;

    setLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch("/api/sales/import/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          sheet_name: sheetName,
          csv_text: csvText,
          is_opening_balance: isOpeningBalance,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusMessage({ type: "error", text: data.error || "Tizimga import qilishda xatolik" });
      } else {
        setStatusMessage({
          type: "success",
          text: `Muvaffaqiyatli import qilindi! Partiya №: ${data.batch_no}. Saqlangan qatorlar: ${data.valid_rows || preview?.summary.valid_rows}.`,
        });
        setPreview(null);
        setCsvText("");
        await loadBatches();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Import xatosi: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 text-white rounded-3xl p-6 border-2 border-emerald-500/30 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase font-extrabold tracking-widest text-emerald-400 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Google Sheets Paritet & Tarixiy Migratsiya
            </div>
            <h2 className="text-2xl font-black mt-1 text-white">Boshqaruvchi Google Sheets Import Dasturi</h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl font-medium">
              Boshqaruvchining amaldagi barcha 6 ta jadvallari (&quot;Zavod bilan&quot;, &quot;Tovar olish&quot;, &quot;Lom pateriya&quot;, &quot;Sanatoni&quot;, &quot;Otush&quot;, &quot;Buxoro&quot;) va boshlang&apos;ich qoldiqlarni xavfsiz PostgreSQL ledgeriga import qilish.
            </p>
          </div>
          <div className="bg-slate-900/80 border border-slate-700/80 rounded-2xl p-3 text-right">
            <div className="text-xs text-slate-400">Qo&apos;llab-quvvatlanadigan format</div>
            <div className="text-sm font-bold text-emerald-300 font-mono">CSV (Vergul / Nuqta-vergul)</div>
          </div>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div
          className={`px-4 py-3 rounded-2xl border-2 flex items-center justify-between shadow-sm ${
            statusMessage.type === "success"
              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
              : "bg-rose-50 border-rose-300 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-bold">
            <span>{statusMessage.type === "success" ? "✅" : "⚠️"}</span>
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="font-bold opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* Main configuration grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Settings & upload form */}
        <div className="lg:col-span-1 bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <span>⚙️</span> Import Sozlamalari
          </h3>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Jadval Turi</label>
            <select
              value={sheetName}
              onChange={(e) => {
                setSheetName(e.target.value);
                setPreview(null);
                if (e.target.value === "opening_balances") {
                  setIsOpeningBalance(true);
                }
              }}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-slate-50 font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="Zavod bilan">🏭 Zavod bilan (Zavoddan tovar kirimi)</option>
              <option value="Tovar olish">🪙 Tovar olish (Naqd pulga oltin xarid)</option>
              <option value="Lom pateriya">⚗️ Lom pateriya (Afinaj va chiqish)</option>
              <option value="Sanatoni sotuv">🛍️ Sanatoni sotuv (Jamshid)</option>
              <option value="Otush sotuv">🛍️ Otush sotuv (Dilshod)</option>
              <option value="Buxoro sotuv">🛍️ Buxoro sotuv (Jasur)</option>
              <option value="opening_balances">⚖️ Boshlang&apos;ich Qoldiqlar (Opening Balance)</option>
            </select>
          </div>

          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
            <input
              type="checkbox"
              id="isOpeningBalanceCheck"
              checked={isOpeningBalance}
              onChange={(e) => setIsOpeningBalance(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
            />
            <label htmlFor="isOpeningBalanceCheck" className="text-xs font-bold text-slate-800 cursor-pointer">
              Boshlang&apos;ich qoldiq rejimi (Opening balance)
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase">Fayldan Yuklash</label>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={handleLoadSample}
            className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
          >
            📋 Namuna ma&apos;lumotlarini yuklash
          </button>

          <div className="pt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={handlePreview}
              disabled={loading || !csvText.trim()}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-xs rounded-xl transition shadow-md flex items-center justify-center gap-2"
            >
              {loading ? "⏳ Tahlil qilinmoqda..." : "🔍 Tekshirish & Ko'rish (Preview)"}
            </button>

            {preview && preview.summary.valid_rows > 0 && (
              <button
                type="button"
                onClick={handleExecute}
                disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs rounded-xl transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
              >
                {loading ? "⏳ Saqlanmoqda..." : `⚡ Tizimga Import Qilish (${preview.summary.valid_rows} qator)`}
              </button>
            )}
          </div>
        </div>

        {/* Right: CSV Raw Input or Preview Results */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-slate-900 text-base">CSV Matni</h3>
              <span className="text-xs text-slate-400 font-mono">{csvText.length} belgi</span>
            </div>
            <textarea
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setPreview(null);
              }}
              rows={8}
              placeholder={`Sana,Mahsulot nomi,Vazn (g),Proba,...\n(CSV ma'lumotlarini bu yerga joylashtiring yoki fayl yuklang)`}
              className="w-full p-3 font-mono text-xs rounded-2xl border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
            />
          </div>

          {/* Preview metrics card */}
          {preview && (
            <div className="bg-white rounded-3xl p-6 border-2 border-emerald-300 shadow-md space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <span>📊</span> Import Oldindan Ko&apos;rish Natijalari
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-lg">
                    To&apos;g&apos;ri: {preview.summary.valid_rows}
                  </span>
                  {preview.summary.skipped_rows > 0 && (
                    <span className="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-lg">
                      Xato: {preview.summary.skipped_rows}
                    </span>
                  )}
                  <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-lg">
                    Jami: {preview.summary.total_rows}
                  </span>
                </div>
              </div>

              {/* Total calculations */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div className="text-slate-500 font-medium">Jami Oltin Vazni</div>
                  <div className="text-base font-black font-mono text-amber-600 mt-0.5">
                    {formatScreenGrams(preview.summary.total_weight_g)}
                  </div>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div className="text-slate-500 font-medium">Jami Naqd Summa</div>
                  <div className="text-base font-black font-mono text-emerald-700 mt-0.5">
                    {formatScreenUZS(preview.summary.total_cash_amount)}
                  </div>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div className="text-slate-500 font-medium">Jadval Nomi</div>
                  <div className="text-xs font-bold text-slate-800 mt-1">{preview.sheet_name}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div className="text-slate-500 font-medium">Holati</div>
                  <div className="text-xs font-bold text-emerald-600 mt-1">
                    {preview.summary.valid_rows > 0 ? "Tayyor (Saqlash mumkin)" : "Yaroqsiz"}
                  </div>
                </div>
              </div>

              {/* Sample preview rows table */}
              <div className="overflow-x-auto max-h-60 border border-slate-200 rounded-2xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 font-bold">#</th>
                      <th className="py-2 px-3 font-bold">Holat</th>
                      <th className="py-2 px-3 font-bold">Qator Ma&apos;lumotlari</th>
                      <th className="py-2 px-3 font-bold">Xatolar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.slice(0, 15).map((r) => (
                      <tr key={r.line_number} className={r.is_valid ? "hover:bg-slate-50" : "bg-rose-50/50"}>
                        <td className="py-2 px-3 font-mono font-bold text-slate-500">{r.line_number}</td>
                        <td className="py-2 px-3">
                          {r.is_valid ? (
                            <span className="text-emerald-700 font-bold">✓ To&apos;g&apos;ri</span>
                          ) : (
                            <span className="text-rose-600 font-bold">✕ Xato</span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-800">
                          {JSON.stringify(r.mapped).slice(0, 90)}...
                        </td>
                        <td className="py-2 px-3 text-[11px] text-rose-600">
                          {r.errors.length > 0 ? r.errors.join("; ") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Previous Import Batches History */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
          <span>📜</span> Oxirgi Import Partiyalari Tarixi
        </h3>
        {batches.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs">Hozircha import partiyalari mavjud emas</div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="py-2.5 px-3 font-bold">Partiya №</th>
                  <th className="py-2.5 px-3 font-bold">Jadval Nomi</th>
                  <th className="py-2.5 px-3 font-bold">To&apos;g&apos;ri Qatorlar</th>
                  <th className="py-2.5 px-3 font-bold">Jami Vazn</th>
                  <th className="py-2.5 px-3 font-bold">Jami Naqd</th>
                  <th className="py-2.5 px-3 font-bold">Sana</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{b.batch_no}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">{b.sheet_name}</td>
                    <td className="py-2.5 px-3 font-mono">{b.valid_rows} / {b.total_rows}</td>
                    <td className="py-2.5 px-3 font-mono text-amber-600 font-bold">{formatScreenGrams(b.total_weight_g)}</td>
                    <td className="py-2.5 px-3 font-mono text-emerald-700">{formatScreenUZS(b.total_cash_amount)}</td>
                    <td className="py-2.5 px-3 text-slate-500">{new Date(b.created_at).toLocaleString("uz-UZ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
