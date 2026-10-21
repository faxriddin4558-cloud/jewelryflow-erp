"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  detectBarcodeType,
  parseWeightValue,
  playScannerBeep,
  type Scanner564Config,
  DEFAULT_SCANNER_CONFIG,
  formatGrams,
} from "@/lib/barcode-scanner-engine";

interface ScanLogEntry {
  id: string;
  timestamp: string;
  rawInput: string;
  type: string;
  parsedDetail: string;
  interKeyDeltaMs: number;
  status: "success" | "warning" | "error";
}

export function ScannerDiagnostics() {
  const [inputVal, setInputVal] = useState("");
  const [config, setConfig] = useState<Scanner564Config>(DEFAULT_SCANNER_CONFIG);
  const [logs, setLogs] = useState<ScanLogEntry[]>([]);
  const [lastScanResult, setLastScanResult] = useState<{
    type: string;
    raw: string;
    parsed: string;
    status: "success" | "warning" | "error";
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeyTimeRef = useRef<number>(0);
  const keyIntervalsRef = useRef<number[]>([]);

  // Keep input focused for convenient testing
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    if (lastKeyTimeRef.current > 0) {
      keyIntervalsRef.current.push(now - lastKeyTimeRef.current);
    }
    lastKeyTimeRef.current = now;

    if (e.key === "Enter") {
      e.preventDefault();
      processInput(inputVal);
    }
  };

  const processInput = (text: string) => {
    const raw = text.trim();
    if (!raw) return;

    // Calculate average inter-character latency
    const intervals = keyIntervalsRef.current;
    const avgDelta =
      intervals.length > 0
        ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
        : 0;

    keyIntervalsRef.current = [];
    lastKeyTimeRef.current = 0;
    setInputVal("");

    const detection = detectBarcodeType(raw, config);
    let parsedDetail = "";
    let status: "success" | "warning" | "error" = "error";

    if (detection.type === "model_qr") {
      parsedDetail = `Model QR: ${detection.extractedModelCode || detection.cleanCode}`;
      status = "success";
      if (config.beepEnabled) playScannerBeep("model_switch");
    } else if (detection.type === "weight_barcode") {
      const parsedWeight = parseWeightValue(detection.cleanCode, config.weightDecimalMode);
      if (parsedWeight.success && parsedWeight.weightGrams !== undefined) {
        parsedDetail = `Vazn: ${formatGrams(parsedWeight.weightGrams)} g`;
        status = "success";
        if (config.beepEnabled) playScannerBeep("success");
      } else {
        parsedDetail = parsedWeight.error || "Vazn xatosi";
        status = "error";
        if (config.beepEnabled) playScannerBeep("error");
      }
    } else {
      parsedDetail = "Noma'lum format";
      status = "warning";
      if (config.beepEnabled) playScannerBeep("error");
    }

    const newEntry: ScanLogEntry = {
      id: "scan-" + Date.now(),
      timestamp: new Date().toLocaleTimeString("uz-UZ"),
      rawInput: raw,
      type: detection.type,
      parsedDetail,
      interKeyDeltaMs: avgDelta,
      status,
    };

    setLogs((prev) => [newEntry, ...prev.slice(0, 19)]);
    setLastScanResult({
      type: detection.type,
      raw,
      parsed: parsedDetail,
      status,
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white space-y-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-black text-amber-300 flex items-center gap-2">
            <span>🔍</span> Skaner 564 Diagnostika va Kalibrlash
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Scanner 564 (QR + 1D) apparatidan kelayotgan xom kodlarni tekshirish, tezlik va dekodlash tahlili
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              playScannerBeep("success");
            }}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-300 border border-slate-700 flex items-center gap-1.5"
          >
            <span>🔊</span> Test Ovoz
          </button>
          <button
            onClick={() => setLogs([])}
            className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-xs font-semibold rounded-xl border border-rose-800"
          >
            Tarixni Tozalash
          </button>
        </div>
      </div>

      {/* Interactive Scan Input */}
      <div className="bg-slate-950 border-2 border-amber-500/40 rounded-2xl p-4 space-y-3">
        <label className="text-xs font-bold text-amber-200 uppercase tracking-wider block">
          Jonli Skanerlash Qabul Qiluvchisi (Skaner 564 ni shu yerga qarating):
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="scannerDiagInput"
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Shtrix-kodni skaner qiling yoki kiriting va Enter bosing..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono text-base focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-slate-600"
          />
          <button
            onClick={() => processInput(inputVal)}
            className="px-5 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-sm transition"
          >
            Tahlil Qilish
          </button>
        </div>
        <div className="text-[11px] text-slate-400 flex flex-wrap gap-4">
          <span>
            💡 <strong>Namuna Model QR:</strong> <code className="text-amber-300">JF-M-0001</code>
          </span>
          <span>
            💡 <strong>Namuna Vazn (Nuqta):</strong> <code className="text-emerald-300">14.52</code>
          </span>
          <span>
            💡 <strong>Namuna Vazn (Vergul):</strong> <code className="text-emerald-300">6,06</code>
          </span>
        </div>
      </div>

      {/* Last Result Callout */}
      {lastScanResult && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between ${
            lastScanResult.status === "success"
              ? "bg-emerald-950/40 border-emerald-700/60 text-emerald-200"
              : lastScanResult.status === "warning"
              ? "bg-amber-950/40 border-amber-700/60 text-amber-200"
              : "bg-rose-950/40 border-rose-700/60 text-rose-200"
          }`}
        >
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider">
              So&apos;nggi O&apos;qilgan Kod: <span className="font-mono">{lastScanResult.raw}</span>
            </div>
            <div className="text-base font-bold mt-0.5">{lastScanResult.parsed}</div>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-black/40">
            {lastScanResult.type}
          </span>
        </div>
      )}

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
          <label className="font-bold text-slate-300 block">O&apos;nlik Ajratuvchi Rejimi:</label>
          <select
            value={config.weightDecimalMode}
            onChange={(e) =>
              setConfig({
                ...config,
                weightDecimalMode: e.target.value as Scanner564Config["weightDecimalMode"],
              })
            }
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
          >
            <option value="auto">Avtomatik (Nuqta va Vergul)</option>
            <option value="dot">Faqat Nuqta (14.52)</option>
            <option value="comma">Faqat Vergul (14,52)</option>
            <option value="implicit_2">Qat&apos;iy 2 xona (00606 -&gt; 6.06)</option>
          </select>
        </div>

        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
          <label className="font-bold text-slate-300 block">
            Takroriy O&apos;qish Cheklovi (Debounce ms):
          </label>
          <input
            type="number"
            min="100"
            max="2000"
            step="50"
            value={config.debounceMs}
            onChange={(e) =>
              setConfig({ ...config, debounceMs: parseInt(e.target.value, 10) || 350 })
            }
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
          />
        </div>

        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
          <label className="font-bold text-slate-300 block">Ovozli Signal (Beep):</label>
          <button
            onClick={() => setConfig({ ...config, beepEnabled: !config.beepEnabled })}
            className={`w-full py-2 px-3 rounded-xl font-bold border transition ${
              config.beepEnabled
                ? "bg-emerald-950 border-emerald-700 text-emerald-300"
                : "bg-slate-800 border-slate-700 text-slate-400"
            }`}
          >
            {config.beepEnabled ? "✓ Ovoz Yoniq" : "✕ Ovoz O&apos;chiq"}
          </button>
        </div>
      </div>

      {/* Log Table */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Oxirgi Skanerlash Qatorlari ({logs.length}):
        </h3>
        {logs.length === 0 ? (
          <div className="bg-slate-950/60 rounded-2xl p-6 text-center text-xs text-slate-500 border border-slate-800">
            Hozircha hech qanday kod skaner qilinmadi. Skaner 564 orqali kodlarni sinab ko&apos;ring.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Vaqt</th>
                  <th className="py-2.5 px-3">Xom Kod (Raw)</th>
                  <th className="py-2.5 px-3">Turi</th>
                  <th className="py-2.5 px-3">Tahlil Natijasi</th>
                  <th className="py-2.5 px-3">Tezlik (ms/belgi)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-900/50">
                    <td className="py-2 px-3 text-slate-400">{log.timestamp}</td>
                    <td className="py-2 px-3 font-bold text-white">{log.rawInput}</td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          log.type === "model_qr"
                            ? "bg-amber-950 text-amber-300 border border-amber-800"
                            : log.type === "weight_barcode"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {log.type}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-sans text-slate-200">{log.parsedDetail}</td>
                    <td className="py-2 px-3 text-slate-400">
                      {log.interKeyDeltaMs > 0 ? (
                        <span
                          className={
                            log.interKeyDeltaMs < 30 ? "text-emerald-400" : "text-amber-400"
                          }
                        >
                          ~{log.interKeyDeltaMs} ms {log.interKeyDeltaMs < 30 ? "(Apparat)" : "(Qo'lda)"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
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
