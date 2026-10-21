/**
 * JewelryFlow ERP — Barcode Scanner 564 & BarTender Engine
 *
 * Implements:
 * 1. Two-Code System: Model QR Code (JF-M-xxxx) + Weight Linear Barcode (e.g. 14.52g)
 * 2. High-speed keyboard-wedge barcode listener for Scanner 564
 * 3. Configurable barcode prefixes, formats and decimal separators (dot, comma, implicit 2)
 * 4. Precision decimal accumulation without floating-point drift
 * 5. Accidental double-scan timing debounce guard with manual override
 * 6. Synthesized audio (Web Audio API) and visual feedback
 * 7. BarTender CSV export and tag binding documentation
 */

export type ScannedBarcodeType = 'model_qr' | 'weight_barcode' | 'unknown';

export interface Scanner564Config {
  /** Prefix used to identify Model QR codes, default: 'JF-M-' (also matches 'M-') */
  modelPrefixes: string[];
  /** Expected decimal mode: 'auto' | 'dot' | 'comma' | 'implicit_2' */
  weightDecimalMode: 'auto' | 'dot' | 'comma' | 'implicit_2';
  /** Minimum acceptable jewelry piece weight in grams, default: 0.05 */
  minWeightGrams: number;
  /** Maximum acceptable jewelry piece weight in grams, default: 1000.0 */
  maxWeightGrams: number;
  /** Debounce window for exact same weight code to prevent scanner hardware bounce (ms), default: 350 */
  debounceMs: number;
  /** Whether synthesized Web Audio sound is enabled, default: true */
  beepEnabled: boolean;
}

export const DEFAULT_SCANNER_CONFIG: Scanner564Config = {
  modelPrefixes: ['JF-M-', 'M-', 'MODEL:'],
  weightDecimalMode: 'auto',
  minWeightGrams: 0.05,
  maxWeightGrams: 1000.0,
  debounceMs: 350,
  beepEnabled: true,
};

export interface JewelryModelItem {
  id: string;
  model_code: string;
  name: string;
  category?: string | null;
  decorations?: string | null;
  reference_weight_grams?: number | null;
  gold_purity?: number | string | null;
  is_active?: boolean;
}

export interface ScannedPieceItem {
  id: string; // Unique internal piece session ID (e.g. UUID)
  modelId?: string;
  modelCode: string;
  modelName: string;
  category?: string;
  purity: number;
  weightGrams: number; // Exact jewelry base grams (4 decimal places)
  rawBarcode: string;
  scannedAt: number;
}

export interface DraftScanSession {
  activeModel: JewelryModelItem | null;
  pieces: ScannedPieceItem[];
  totalPieces: number;
  totalWeightGrams: number;
  byModel: Record<
    string,
    {
      modelCode: string;
      modelName: string;
      category?: string;
      count: number;
      totalWeightGrams: number;
      pieces: ScannedPieceItem[];
    }
  >;
  lastScanTimestamp: number;
  lastRawCode: string;
}

export function createEmptyScanSession(): DraftScanSession {
  return {
    activeModel: null,
    pieces: [],
    totalPieces: 0,
    totalWeightGrams: 0,
    byModel: {},
    lastScanTimestamp: 0,
    lastRawCode: '',
  };
}

/**
 * Accurate 4-decimal addition to eliminate IEEE 754 floating point drift
 */
export function addGrams(a: number, b: number): number {
  return Math.round((Number(a || 0) + Number(b || 0)) * 10000) / 10000;
}

/**
 * Accurate 4-decimal subtraction
 */
export function subtractGrams(a: number, b: number): number {
  return Math.round((Number(a || 0) - Number(b || 0)) * 10000) / 10000;
}

/**
 * Format physical jewelry grams nicely (e.g. 14.5200)
 */
export function formatGrams(grams: number, decimals = 4): string {
  return (Number(grams) || 0).toFixed(decimals);
}

/**
 * Detect barcode category: Model QR code vs Weight Linear Barcode
 */
export function detectBarcodeType(
  rawInput: string,
  config: Scanner564Config = DEFAULT_SCANNER_CONFIG
): { type: ScannedBarcodeType; cleanCode: string; extractedModelCode?: string } {
  const clean = (rawInput || '').trim();
  if (!clean) {
    return { type: 'unknown', cleanCode: '' };
  }

  // 1. Check for JSON QR payload
  if (clean.startsWith('{') && clean.endsWith('}')) {
    try {
      const parsed = JSON.parse(clean);
      if (parsed.model_code || parsed.modelCode) {
        return {
          type: 'model_qr',
          cleanCode: clean,
          extractedModelCode: String(parsed.model_code || parsed.modelCode).toUpperCase(),
        };
      }
    } catch {}
  }

  // 2. Check for configured Model QR Prefixes (e.g. 'JF-M-0001', 'M-0001')
  const upper = clean.toUpperCase();
  for (const prefix of config.modelPrefixes) {
    const pUpper = prefix.toUpperCase();
    if (upper.startsWith(pUpper)) {
      return {
        type: 'model_qr',
        cleanCode: clean,
        extractedModelCode: upper,
      };
    }
  }

  // 3. Weight prefix if any (e.g. 'W:14.52' or 'WT-14.52')
  let weightStr = clean;
  if (/^W(T)?[:\-_ ]/i.test(weightStr)) {
    weightStr = weightStr.replace(/^W(T)?[:\-_ ]/i, '');
  }

  // 4. Test if input is a valid weight number
  const parsedWeight = parseWeightValue(weightStr, config.weightDecimalMode);
  if (parsedWeight.success) {
    return {
      type: 'weight_barcode',
      cleanCode: weightStr,
    };
  }

  return { type: 'unknown', cleanCode: clean };
}

/**
 * Parses weight string safely with configurable decimal modes
 */
export function parseWeightValue(
  rawStr: string,
  mode: Scanner564Config['weightDecimalMode'] = 'auto'
): { success: boolean; weightGrams?: number; error?: string } {
  const s = (rawStr || '').trim();
  if (!s) {
    return { success: false, error: "Bo'sh qiymat kiritildi" };
  }

  // If implicit 2 decimals mode (e.g. '00606' -> 6.06)
  if (mode === 'implicit_2' && /^\d+$/.test(s)) {
    const val = parseInt(s, 10) / 100;
    return { success: true, weightGrams: Math.round(val * 10000) / 10000 };
  }

  // Normalize decimal separators
  let normalized = s;
  if (mode === 'comma') {
    normalized = normalized.replace(',', '.');
  } else if (mode === 'dot') {
    // Keep as is
  } else {
    // Auto mode: replace comma if no dot exists
    if (normalized.includes(',') && !normalized.includes('.')) {
      normalized = normalized.replace(',', '.');
    }
  }

  // Validate numeric format (e.g. 14.52 or 6)
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { success: false, error: `Noto'g'ri raqamli vazn formati: "${s}"` };
  }

  const num = parseFloat(normalized);
  if (isNaN(num) || !isFinite(num)) {
    return { success: false, error: 'Vazn raqam emas' };
  }

  if (num <= 0) {
    return { success: false, error: 'Vazn 0 dan katta bo‘lishi shart' };
  }

  return {
    success: true,
    weightGrams: Math.round(num * 10000) / 10000,
  };
}

/**
 * Process a scanned barcode input from Scanner 564 into the active session
 */
export function processScannedCode(
  rawInput: string,
  session: DraftScanSession,
  availableModels: JewelryModelItem[],
  config: Scanner564Config = DEFAULT_SCANNER_CONFIG,
  options?: { allowDuplicateOverride?: boolean }
): {
  success: boolean;
  action: 'model_switched' | 'piece_added' | 'duplicate_warning' | 'error';
  session: DraftScanSession;
  message: string;
  piece?: ScannedPieceItem;
  model?: JewelryModelItem;
} {
  const now = Date.now();
  const detection = detectBarcodeType(rawInput, config);

  // 1. Model QR Code detected
  if (detection.type === 'model_qr') {
    const targetCode = detection.extractedModelCode || detection.cleanCode.toUpperCase();
    const foundModel = availableModels.find(
      (m) =>
        m.model_code.toUpperCase() === targetCode ||
        m.model_code.toUpperCase().replace(/^JF-/, '') === targetCode.replace(/^JF-/, '')
    );

    if (!foundModel) {
      return {
        success: false,
        action: 'error',
        session,
        message: `Model bazada topilmadi: "${targetCode}". BarTender modellar ro'yxatini tekshiring.`,
      };
    }

    const updatedSession: DraftScanSession = {
      ...session,
      activeModel: foundModel,
      lastScanTimestamp: now,
      lastRawCode: rawInput,
    };

    return {
      success: true,
      action: 'model_switched',
      session: updatedSession,
      message: `Faol model tanlandi: ${foundModel.name} (${foundModel.model_code})`,
      model: foundModel,
    };
  }

  // 2. Weight Linear Barcode detected
  if (detection.type === 'weight_barcode') {
    if (!session.activeModel) {
      return {
        success: false,
        action: 'error',
        session,
        message: 'Avval Model QR kodini skaner qiling! (Masalan: Malika JF-M-0001)',
      };
    }

    const parseResult = parseWeightValue(detection.cleanCode, config.weightDecimalMode);
    if (!parseResult.success || parseResult.weightGrams === undefined) {
      return {
        success: false,
        action: 'error',
        session,
        message: parseResult.error || "Noto'g'ri vazn shtrix-kodi",
      };
    }

    const weight = parseResult.weightGrams;

    // Range validation
    if (weight < config.minWeightGrams || weight > config.maxWeightGrams) {
      return {
        success: false,
        action: 'error',
        session,
        message: `Vazn me'yordan tashqarida: ${weight}g (ruxsat: ${config.minWeightGrams}g - ${config.maxWeightGrams}g)`,
      };
    }

    // Debounce guard: identical weight code scanned in rapid succession (< debounceMs)
    const timeDelta = now - session.lastScanTimestamp;
    if (
      !options?.allowDuplicateOverride &&
      session.lastRawCode === rawInput &&
      timeDelta < config.debounceMs
    ) {
      return {
        success: false,
        action: 'duplicate_warning',
        session,
        message: `Ehtiyot bo'ling: Bir xil vazn (${weight}g) juda tez takrorlandi (${timeDelta}ms). Skaner qayta o'qishi bo'lishi mumkin. Agar bu alohida dona bo'lsa, qayta tasdiqlang.`,
      };
    }

    // Generate unique piece record
    const newPiece: ScannedPieceItem = {
      id: generateUniquePieceId(),
      modelId: session.activeModel.id,
      modelCode: session.activeModel.model_code,
      modelName: session.activeModel.name,
      category: session.activeModel.category || 'Серьги',
      purity: Number(session.activeModel.gold_purity) || 585,
      weightGrams: weight,
      rawBarcode: rawInput,
      scannedAt: now,
    };

    // Add piece to session and update model aggregation
    const updatedPieces = [...session.pieces, newPiece];
    const newTotalWeight = addGrams(session.totalWeightGrams, weight);
    const mCode = session.activeModel.model_code;
    const existingGroup = session.byModel[mCode] || {
      modelCode: mCode,
      modelName: session.activeModel.name,
      category: session.activeModel.category || 'Серьги',
      count: 0,
      totalWeightGrams: 0,
      pieces: [],
    };

    const updatedByModel = {
      ...session.byModel,
      [mCode]: {
        ...existingGroup,
        count: existingGroup.count + 1,
        totalWeightGrams: addGrams(existingGroup.totalWeightGrams, weight),
        pieces: [...existingGroup.pieces, newPiece],
      },
    };

    const updatedSession: DraftScanSession = {
      ...session,
      pieces: updatedPieces,
      totalPieces: updatedPieces.length,
      totalWeightGrams: newTotalWeight,
      byModel: updatedByModel,
      lastScanTimestamp: now,
      lastRawCode: rawInput,
    };

    return {
      success: true,
      action: 'piece_added',
      session: updatedSession,
      message: `+1 dona qo'shildi: ${session.activeModel.name} — ${formatGrams(weight)}g`,
      piece: newPiece,
      model: session.activeModel,
    };
  }

  // 3. Unknown code
  return {
    success: false,
    action: 'error',
    session,
    message: `Noma'lum shtrix-kod formati: "${rawInput}". Model QR (JF-M-...) yoki vazn (masalan: 14.52) kutilmoqda.`,
  };
}

/**
 * Remove a specific piece by internal ID from session
 */
export function removePieceFromSession(
  session: DraftScanSession,
  pieceId: string
): DraftScanSession {
  const pieceIndex = session.pieces.findIndex((p) => p.id === pieceId);
  if (pieceIndex === -1) return session;

  const targetPiece = session.pieces[pieceIndex];
  if (!targetPiece) return session;

  const updatedPieces = session.pieces.filter((p) => p.id !== pieceId);
  const newTotalWeight = subtractGrams(session.totalWeightGrams, targetPiece.weightGrams);

  const mCode = targetPiece.modelCode;
  const existingGroup = session.byModel[mCode];
  const updatedByModel = { ...session.byModel };

  if (existingGroup) {
    const groupPieces = existingGroup.pieces.filter((p) => p.id !== pieceId);
    if (groupPieces.length === 0) {
      delete updatedByModel[mCode];
    } else {
      updatedByModel[mCode] = {
        ...existingGroup,
        count: groupPieces.length,
        totalWeightGrams: subtractGrams(existingGroup.totalWeightGrams, targetPiece.weightGrams),
        pieces: groupPieces,
      };
    }
  }

  return {
    ...session,
    pieces: updatedPieces,
    totalPieces: updatedPieces.length,
    totalWeightGrams: Math.max(0, newTotalWeight),
    byModel: updatedByModel,
  };
}

/**
 * Undo last scanned piece
 */
export function undoLastScannedPiece(session: DraftScanSession): {
  session: DraftScanSession;
  removedPiece?: ScannedPieceItem;
} {
  if (session.pieces.length === 0) {
    return { session };
  }
  const lastPiece = session.pieces[session.pieces.length - 1];
  if (!lastPiece) {
    return { session };
  }
  const newSession = removePieceFromSession(session, lastPiece.id);
  const prevPiece = newSession.pieces.length > 0 ? newSession.pieces[newSession.pieces.length - 1] : null;
  return {
    session: {
      ...newSession,
      lastRawCode: prevPiece ? prevPiece.rawBarcode : '',
      lastScanTimestamp: 0,
    },
    removedPiece: lastPiece,
  };
}

/**
 * Helper to generate an internal piece UUID
 */
export function generateUniquePieceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'pc-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
}

/**
 * Synthesize Scanner 564 audio beeps using HTML5 Web Audio API
 */
export function playScannerBeep(
  type: 'success' | 'model_switch' | 'error' | 'duplicate_warning'
): void {
  if (typeof window === 'undefined') return;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'success') {
      // Crisp high beep: 880 Hz (A5), 70ms
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.07);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'model_switch') {
      // Double melodic chime: 587 Hz -> 880 Hz
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.06);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'duplicate_warning') {
      // Double mid-frequency warning: 440 Hz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.13);
    } else {
      // Error buzz: 220 Hz low tone
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.22);
    }
  } catch {
    // AudioContext blocked or not allowed — fail gracefully
  }
}

/**
 * Generates BarTender-compatible CSV for data source binding
 */
export function generateBarTenderCsv(models: JewelryModelItem[]): string {
  const headers = [
    'ModelCode',
    'ModelName',
    'Category',
    'Purity',
    'Decorations',
    'ReferenceWeightGrams',
    'QrPayload',
  ];

  const escapeCsv = (val: unknown) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = models.map((m) => [
    escapeCsv(m.model_code),
    escapeCsv(m.name),
    escapeCsv(m.category || 'Серьги'),
    escapeCsv(m.gold_purity || '585'),
    escapeCsv(m.decorations || ''),
    escapeCsv(m.reference_weight_grams ? formatGrams(m.reference_weight_grams) : ''),
    escapeCsv(m.model_code), // Clean QR payload for BarTender
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * LocalStorage session persistence helper
 */
const STORAGE_KEY = 'jewelryflow_scanner_draft_session_v1';

export function saveSessionToStorage(session: DraftScanSession): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {}
}

export function loadSessionFromStorage(): DraftScanSession | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const data = window.localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data) as DraftScanSession;
  } catch {
    return null;
  }
}

export function clearSessionFromStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
