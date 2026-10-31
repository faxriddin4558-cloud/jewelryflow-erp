"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { playScannerBeep } from "@/lib/barcode-scanner-engine";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
  hint?: string;
}

export function MobileBarcodeScannerModal({
  isOpen,
  onClose,
  onDetected,
  title = "Kamera / Skaner 564",
  hint = "Model QR kodi yoki vazn shtrix-kodini kameraga qarating",
}: Props) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startDetectionLoop = useCallback(() => {
    const detectorClass = (window as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;

    if (detectorClass) {
      try {
        const detector = new detectorClass({
          formats: ["qr_code", "code_128", "ean_13", "code_39"],
        });

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0 && barcodes[0]?.rawValue) {
              const code = barcodes[0].rawValue.trim();
              playScannerBeep("success");
              stopCamera();
              onDetected(code);
              onClose();
            }
          } catch {}
        }, 200);
      } catch {}
    }
  }, [onDetected, onClose, stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError("Kamera interfeysi brauzeringizda qo'llab-quvvatlanmaydi.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        startDetectionLoop();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(`Kameraga ulanishda xatolik: ${msg}. Iltimos, shtrix-kodni qo'lda kiriting.`);
      setCameraActive(false);
    }
  }, [startDetectionLoop]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    void startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = manualCode.trim();
    if (!raw) return;

    playScannerBeep("success");
    stopCamera();
    onDetected(raw);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl max-w-md w-full p-5 text-white shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-black text-amber-300">{title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 font-bold"
          >
            ✕
          </button>
        </div>

        {/* Camera Viewfinder View */}
        <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />

          {!cameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-xs text-slate-300 space-y-2 bg-slate-950/95">
              <span className="text-3xl">📷</span>
              <div className="font-bold text-amber-300">
                {cameraError ? "Kamera Ruxsati Talab Qilinadi" : "Kamera yuklanmoqda..."}
              </div>
              {cameraError && (
                <div className="text-[11px] text-slate-400 max-w-xs space-y-1 leading-relaxed text-left bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                  <div className="font-semibold text-slate-300">Samsung/Android uchun ko&apos;rsatma:</div>
                  <div>1. Brauzer manzilidagi qulf (🔒) belgisini bosing.</div>
                  <div>2. &quot;Sayt sozlamalari&quot; → <strong>Kamera</strong> parametrini &quot;Ruxsat berish&quot;ga o&apos;tkazing.</div>
                  <div className="pt-1 text-amber-400 font-medium">Yoki pastdagi maydonga shtrix-kodni qo&apos;lda kiriting / Skaner 564 ishlating.</div>
                </div>
              )}
            </div>
          )}

          {cameraActive && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-48 h-32 border-2 border-amber-400 rounded-xl relative animate-pulse">
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-rose-500 shadow-sm" />
              </div>
            </div>
          )}
        </div>

        {/* Manual Fallback Input */}
        <form onSubmit={handleManualSubmit} className="space-y-2 pt-1 border-t border-slate-800">
          <label className="text-[11px] font-bold text-slate-300 block">
            Yoki shtrix-kodni qo&apos;lda kiriting / Skaner 564:
          </label>
          <div className="flex gap-2">
            <input
              id="mobileManualBarcodeInput"
              type="text"
              autoFocus
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Masalan: JF-M-0001 yoki 14.52"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition"
            >
              Kiritish
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
