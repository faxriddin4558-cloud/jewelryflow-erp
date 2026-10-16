import { useState, useEffect, useCallback, useRef } from "react";
import {
  isWebSerialSupported,
  scaleDriver,
  MockScaleDriver,
  type ScaleReading,
  type SerialScaleOptions,
} from "@/lib/hardware/scale-serial";

export interface UseScaleReaderResult {
  isSupported: boolean;
  isConnected: boolean;
  reading: ScaleReading | null;
  liveWeight: number;
  isStable: boolean;
  error: string | null;
  connect: (options?: SerialScaleOptions) => Promise<boolean>;
  disconnect: () => Promise<void>;
  connectMockScale: (mockWeight?: number) => Promise<boolean>;
}

export function useScaleReader(): UseScaleReaderResult {
  const [isSupported] = useState<boolean>(() => isWebSerialSupported());
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mockDriverRef = useRef<MockScaleDriver | null>(null);

  useEffect(() => {
    const unsubReading = scaleDriver.onReading((r) => {
      setReading(r);
    });

    const unsubStatus = scaleDriver.onStatusChange((connected, err) => {
      setIsConnected(connected);
      if (err) setError(err);
      if (!connected) setReading(null);
    });

    // Check if a paired port can be auto-connected
    void scaleDriver.autoConnectPaired();

    return () => {
      unsubReading();
      unsubStatus();
      if (mockDriverRef.current) {
        void mockDriverRef.current.disconnect();
      }
    };
  }, []);

  const connect = useCallback(async (options?: SerialScaleOptions): Promise<boolean> => {
    setError(null);
    try {
      const ok = await scaleDriver.requestAndConnect(options);
      if (!ok) {
        setError("Tarozi ulanmadi yoki bekor qilindi");
      }
      return ok;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Tarozi ulanishida xatolik";
      setError(msg);
      return false;
    }
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    if (mockDriverRef.current && mockDriverRef.current.isConnected()) {
      await mockDriverRef.current.disconnect();
      mockDriverRef.current = null;
      setIsConnected(false);
      setReading(null);
      return;
    }
    await scaleDriver.disconnect();
    setIsConnected(false);
    setReading(null);
  }, []);

  const connectMockScale = useCallback(async (mockWeight = 18.425): Promise<boolean> => {
    setError(null);
    if (!mockDriverRef.current) {
      mockDriverRef.current = new MockScaleDriver();
      mockDriverRef.current.onReading((r) => setReading(r));
      mockDriverRef.current.onStatusChange((conn) => {
        setIsConnected(conn);
        if (!conn) setReading(null);
      });
    }
    await mockDriverRef.current.connect(mockWeight);
    return true;
  }, []);

  return {
    isSupported,
    isConnected,
    reading,
    liveWeight: reading?.weight ?? 0,
    isStable: reading?.isStable ?? true,
    error,
    connect,
    disconnect,
    connectMockScale,
  };
}
