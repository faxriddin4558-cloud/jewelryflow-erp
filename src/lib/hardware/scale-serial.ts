/**
 * JewelryFlow ERP — Web Serial Precision Scale Driver
 *
 * Implements direct browser-to-scale communication via the W3C Web Serial API.
 * Supports standard laboratory and jewelry precision scales (Ohaus, Sartorius, CAS, Vibra, Mettler Toledo, and generic RS-232/USB scales).
 *
 * Eliminates manual weight entry errors in two-party handovers and gold vault transactions.
 */

export interface ScaleReading {
  raw: string;
  weight: number;
  unit: "g" | "ct" | "kg" | "oz";
  isStable: boolean;
  isNegative: boolean;
  timestamp: number;
  isUnitValid: boolean;
  mode: "AUTO_SCALE" | "MANUAL_ENTRY";
}

export interface SerialScaleOptions {
  baudRate?: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
}

export interface ScaleDriverEvents {
  onReading?: (reading: ScaleReading) => void;
  onStatusChange?: (connected: boolean, error?: string) => void;
}

interface SerialPortLike {
  open: (options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }) => Promise<void>;
  close: () => Promise<void>;
  readable: {
    getReader: () => SerialReaderLike;
  } | null;
}

interface SerialReaderLike {
  read: () => Promise<{ value?: Uint8Array; done: boolean }>;
  releaseLock: () => void;
  cancel: () => Promise<void>;
}

interface NavigatorWithSerial {
  serial: {
    requestPort: () => Promise<SerialPortLike>;
    getPorts: () => Promise<SerialPortLike[]>;
    addEventListener?: (type: string, listener: (ev: unknown) => void) => void;
  };
}

export interface ScaleProtocolProfile {
  id: string;
  name: string;
  manufacturer: string;
  defaultBaudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
  description: string;
}

export const SUPPORTED_SCALE_PROFILES: ScaleProtocolProfile[] = [
  {
    id: "ohaus-defender-scout",
    name: "Ohaus Scout / Defender / Navigator",
    manufacturer: "Ohaus Corporation",
    defaultBaudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    description: "Standard continuous ASCII stream (ST,+12.34g / ?12.34g)",
  },
  {
    id: "sartorius-quintix-entris",
    name: "Sartorius Entris / Practum / Quintix",
    manufacturer: "Sartorius AG",
    defaultBaudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    description: "SBI / 16-character continuous format (N + 12.3450 g)",
  },
  {
    id: "sartorius-7e1",
    name: "Sartorius Classic Laboratory (7-E-1)",
    manufacturer: "Sartorius AG",
    defaultBaudRate: 9600,
    dataBits: 7,
    stopBits: 1,
    parity: "even",
    description: "Legacy 7-bit Even Parity configuration",
  },
  {
    id: "cas-sw-mwp",
    name: "CAS SW / MWP / CI-Series",
    manufacturer: "CAS Scale Corporation",
    defaultBaudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    description: "CAS 22-byte continuous protocol (ST,GS,+12.345 g)",
  },
  {
    id: "vibra-aj-sj",
    name: "Vibra (Shinko Denshi) AJ / SJ / LN",
    manufacturer: "Shinko Denshi Co., Ltd.",
    defaultBaudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    description: "Tuning-fork precision scale continuous stream",
  },
  {
    id: "mettler-toledo-mt-sics",
    name: "Mettler Toledo (MT-SICS)",
    manufacturer: "Mettler Toledo",
    defaultBaudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    description: "Standard MT-SICS command/response and stream",
  },
  {
    id: "generic-rs232",
    name: "Standart RS-232 / USB Virtual COM",
    manufacturer: "Generic Electronic Scales",
    defaultBaudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    description: "Moslashuvchan RS-232/USB tarozi protokoli",
  },
];

export interface ScaleDiagnosticsReport {
  isWebSerialSupported: boolean;
  recommendedBrowser: string;
  isBrowserCompatible: boolean;
  supportedProfiles: ScaleProtocolProfile[];
  supportedBaudRates: number[];
  calibrationNotice: string;
  operationalGuidelines: string[];
}

/**
 * Returns diagnostics information, supported profiles, and factory calibration requirements.
 */
export function getScaleDiagnostics(): ScaleDiagnosticsReport {
  const supported = isWebSerialSupported();
  return {
    isWebSerialSupported: supported,
    recommendedBrowser: "Google Chrome 89+ yoki Microsoft Edge 89+ (Desktop)",
    isBrowserCompatible: supported,
    supportedProfiles: SUPPORTED_SCALE_PROFILES,
    supportedBaudRates: [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200],
    calibrationNotice:
      "MUHIM KALIBRATSIYA TALABI: Ishlab chiqarish va oltin omborida taroziga tayanib operatsiya o'tkazishdan oldin har bir tarozi joyida (on-site) davlat metrologiya standarti (F1/F2 klassli etalon toshlar) bilan kalibratsiya qilinishi, tekislik pufagi (spirit level) markazga keltirilishi va havo oqimidan himoya qilingan shisha kamera ichida ishlatilishi shart!",
    operationalGuidelines: [
      "1. Tarozini shamollatish moslamasi (konditsioner yoki deraza) yaqiniga qo'ymang.",
      "2. Har doim ekrandagi 'ST' yoki barqarorlik belgisini kutib, keyin qabul qilish tugmasini bosing.",
      "3. Tarani har bir yangi idish yoki patnis uchun alohida nollang (Tare).",
      "4. Agar Web Serial ochilmasa, USB-RS232 drayverini (FTDI yoki CH340) tekshiring.",
    ],
  };
}

/**
 * Checks if the W3C Web Serial API is supported in the current browser environment.
 */
export function isWebSerialSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return "serial" in navigator;
}

/**
 * Parses raw ASCII output from standard electronic jewelry scales.
 * Rejects malformed chunks, non-numeric noise, and out-of-range readings.
 *
 * Examples:
 *  - "ST,GS,+   12.345 g\r\n" -> 12.345 g, stable, valid
 *  - "US,GS,+   12.340 g\r\n" -> 12.340 g, unstable, valid
 *  - "N +  12.3450 g\r\n"     -> 12.345 g, stable, valid
 *  - "+  12.345 g\r\n"        -> 12.345 g, stable, valid
 *  - "  12.345\r\n"          -> 12.345 g, stable, valid
 */
export function parseScaleReading(rawLine: string): ScaleReading | null {
  const line = rawLine.trim();
  if (!line || line.length < 2) return null;

  // 1. Detect stability flags
  let isStable = true;
  if (line.includes("US") || line.includes("?") || line.includes("~") || line.includes("UNSTABLE")) {
    isStable = false;
  } else if (line.includes("ST") || line.includes("S ") || line.includes("OK") || line.includes("STABLE")) {
    isStable = true;
  }

  // 2. Detect unit
  let unit: "g" | "ct" | "kg" | "oz" = "g";
  const lower = line.toLowerCase();
  if (lower.includes("ct") || lower.includes("karat")) {
    unit = "ct";
  } else if (lower.includes("kg")) {
    unit = "kg";
  } else if (lower.includes("oz")) {
    unit = "oz";
  } else {
    unit = "g";
  }

  const isUnitValid = unit === "g";

  // 3. Extract numeric weight
  const match = line.match(/[-+]?\s*(\d+[.,]\d+|\d+)/);
  if (!match) return null;

  const rawNumStr = match[0].replace(/\s+/g, "").replace(",", ".");
  const numericVal = parseFloat(rawNumStr);
  if (Number.isNaN(numericVal)) return null;

  // Reject physically implausible or malformed laboratory readings (0 to 50,000.000g)
  if (numericVal < -1000 || numericVal > 50000) {
    return null;
  }

  const isNegative = numericVal < 0;
  // Milligram precision rounding: 3 decimal places (0.001g)
  const absWeight = Math.round(Math.abs(numericVal) * 1000) / 1000;

  return {
    raw: line,
    weight: absWeight,
    unit,
    isStable,
    isNegative,
    isUnitValid,
    mode: "AUTO_SCALE",
    timestamp: Date.now(),
  };
}

/**
 * Hardware Web Serial Driver for Precision Electronic Scales.
 */
export class ScaleSerialDriver {
  private port: SerialPortLike | null = null;
  private reader: SerialReaderLike | null = null;
  private isReading = false;
  private listeners: Set<(reading: ScaleReading) => void> = new Set();
  private statusListeners: Set<(connected: boolean, error?: string) => void> = new Set();
  private lastReading: ScaleReading | null = null;

  constructor(private defaultOptions: SerialScaleOptions = { baudRate: 9600 }) {}

  public isConnected(): boolean {
    return this.port !== null && this.isReading;
  }

  public getLastReading(): ScaleReading | null {
    return this.lastReading;
  }

  public onReading(cb: (reading: ScaleReading) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  public onStatusChange(cb: (connected: boolean, error?: string) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private notifyStatus(connected: boolean, error?: string) {
    for (const listener of this.statusListeners) {
      try {
        listener(connected, error);
      } catch (err) {
        console.error("[ScaleSerialDriver] Status listener error:", err);
      }
    }
  }

  private notifyReading(reading: ScaleReading) {
    this.lastReading = reading;
    for (const listener of this.listeners) {
      try {
        listener(reading);
      } catch (err) {
        console.error("[ScaleSerialDriver] Reading listener error:", err);
      }
    }
  }

  /**
   * Prompts the user to select an RS232/USB Serial port and begins continuous streaming.
   */
  public async requestAndConnect(options?: SerialScaleOptions): Promise<boolean> {
    if (!isWebSerialSupported()) {
      const err = "Web Serial API brauzerda qo'llab-quvvatlanmaydi (Chrome yoki Edge talab etiladi).";
      this.notifyStatus(false, err);
      throw new Error(err);
    }

    try {
      const nav = navigator as unknown as NavigatorWithSerial;
      this.port = await nav.serial.requestPort();

      // Listen to disconnect events if supported
      if (typeof nav.serial.addEventListener === "function") {
        nav.serial.addEventListener("disconnect", (event: unknown) => {
          const ev = event as { port?: SerialPortLike };
          if (ev.port && ev.port === this.port) {
            void this.disconnect();
            this.notifyStatus(false, "Tarozi porti uzildi (kabel ajratildi).");
          }
        });
      }

      await this.openPort(options);
      return true;
    } catch (err) {
      let msg = "Tarozi portiga ulanishda xatolik";
      if (err instanceof Error) {
        if (err.name === "NotFoundError") {
          msg = "Tarozi porti tanlanmadi (foydalanuvchi tomonidan bekor qilindi).";
        } else if (err.name === "SecurityError" || err.name === "NotAllowedError") {
          msg = "Tarozi portiga ruxsat berilmadi (ruxsat rad etildi). Brauzer sozlamalarida Serial portga ruxsat bering.";
        } else if (err.name === "InvalidStateError" || err.message.toLowerCase().includes("already open")) {
          msg = "Port allaqachon boshqa dastur yoki oyna tomonidan band qilingan.";
        } else {
          msg = `Tarozi ulanish xatosi: ${err.message}`;
        }
      }
      this.notifyStatus(false, msg);
      return false;
    }
  }

  /**
   * Connects to an already paired serial port if available.
   */
  public async autoConnectPaired(options?: SerialScaleOptions): Promise<boolean> {
    if (!isWebSerialSupported()) return false;

    try {
      const nav = navigator as unknown as NavigatorWithSerial;
      const ports = await nav.serial.getPorts();
      if (ports && ports.length > 0) {
        const firstPort = ports[0];
        if (firstPort) {
          this.port = firstPort;
          await this.openPort(options);
          return true;
        }
      }
      return false;
    } catch (err) {
      console.warn("[ScaleSerialDriver] Auto-connect failed:", err);
      return false;
    }
  }

  private async openPort(customOptions?: SerialScaleOptions) {
    if (!this.port) return;
    const opts = { ...this.defaultOptions, ...customOptions };
    await this.port.open({
      baudRate: opts.baudRate || 9600,
      dataBits: opts.dataBits || 8,
      stopBits: opts.stopBits || 1,
      parity: opts.parity || "none",
    });

    this.isReading = true;
    this.notifyStatus(true);
    void this.readLoop();
  }

  private async readLoop() {
    const textDecoder = new TextDecoder();
    let accumulated = "";

    try {
      while (this.port && this.port.readable && this.isReading) {
        this.reader = this.port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) {
              const chunk = textDecoder.decode(value);
              accumulated += chunk;

              // Break into lines by CR or LF
              const lines = accumulated.split(/[\r\n]+/);
              accumulated = lines.pop() || "";

              for (const line of lines) {
                const reading = parseScaleReading(line);
                if (reading) {
                  this.notifyReading(reading);
                }
              }
            }
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (err) {
      if (this.isReading) {
        const msg = err instanceof Error ? err.message : "Tarozi ma'lumotlarini o'qishda uzilish";
        this.notifyStatus(false, msg);
      }
    } finally {
      this.isReading = false;
    }
  }

  /**
   * Safely disconnects the serial scale and closes the port.
   */
  public async disconnect(): Promise<void> {
    this.isReading = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {}
    }
    if (this.port) {
      try {
        await this.port.close();
      } catch {}
      this.port = null;
    }
    this.notifyStatus(false);
  }
}

/**
 * Simulated scale driver for automated tests, demonstrations, and offline environments.
 */
export class MockScaleDriver {
  private readingListeners: Set<(reading: ScaleReading) => void> = new Set();
  private statusListeners: Set<(connected: boolean, error?: string) => void> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentWeight = 15.542;
  private isConnectedState = false;

  public isConnected(): boolean {
    return this.isConnectedState;
  }

  public setWeight(weight: number) {
    this.currentWeight = weight;
    if (this.isConnectedState) {
      this.emitCurrent();
    }
  }

  public connect(mockInitialWeight = 15.542): Promise<boolean> {
    this.currentWeight = mockInitialWeight;
    this.isConnectedState = true;
    for (const l of this.statusListeners) l(true);
    this.emitCurrent(mockInitialWeight);

    this.timer = setInterval(() => {
      // Simulate minor micro-fluctuations before stabilizing
      const jitter = (Math.random() - 0.5) * 0.002;
      const weight = Number((this.currentWeight + jitter).toFixed(3));
      this.emitCurrent(weight);
    }, 500);

    return Promise.resolve(true);
  }

  private emitCurrent(weight = this.currentWeight) {
    const reading: ScaleReading = {
      raw: `ST,GS,+   ${weight.toFixed(3)} g\r\n`,
      weight,
      unit: "g",
      isStable: true,
      isNegative: false,
      isUnitValid: true,
      mode: "AUTO_SCALE",
      timestamp: Date.now(),
    };
    for (const l of this.readingListeners) l(reading);
  }

  public disconnect(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isConnectedState = false;
    for (const l of this.statusListeners) l(false);
    return Promise.resolve();
  }

  public onReading(cb: (reading: ScaleReading) => void): () => void {
    this.readingListeners.add(cb);
    return () => this.readingListeners.delete(cb);
  }

  public onStatusChange(cb: (connected: boolean, error?: string) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
}

export const scaleDriver = new ScaleSerialDriver();
