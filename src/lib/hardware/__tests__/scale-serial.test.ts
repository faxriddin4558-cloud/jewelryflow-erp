// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseScaleReading,
  isWebSerialSupported,
  ScaleSerialDriver,
  MockScaleDriver,
} from "../scale-serial";

describe("ScaleSerialDriver & Scale Protocol Parsers", () => {
  describe("parseScaleReading", () => {
    it("parses CAS / Vibra stable gross reading ST,GS,+  12.345g", () => {
      const res = parseScaleReading("ST,GS,+   12.345 g\r\n");
      expect(res).not.toBeNull();
      expect(res?.weight).toBeCloseTo(12.345, 3);
      expect(res?.unit).toBe("g");
      expect(res?.isStable).toBe(true);
      expect(res?.isNegative).toBe(false);
    });

    it("parses CAS / Vibra unstable gross reading US,GS,+  12.340g", () => {
      const res = parseScaleReading("US,GS,+   12.340 g\r\n");
      expect(res).not.toBeNull();
      expect(res?.weight).toBeCloseTo(12.340, 3);
      expect(res?.isStable).toBe(false);
    });

    it("parses Sartorius net reading with 4-decimal precision N +  12.3450 g", () => {
      const res = parseScaleReading("N +  12.3450 g\r\n");
      expect(res).not.toBeNull();
      expect(res?.weight).toBeCloseTo(12.345, 4);
      expect(res?.unit).toBe("g");
      expect(res?.isStable).toBe(true);
      expect(res?.isNegative).toBe(false);
    });

    it("parses Ohaus question mark unstable reading ?  15.200 g", () => {
      const res = parseScaleReading("?   15.200 g\r\n");
      expect(res).not.toBeNull();
      expect(res?.weight).toBe(15.2);
      expect(res?.isStable).toBe(false);
    });

    it("parses carat (ct) unit reading for gemstones", () => {
      const res = parseScaleReading("ST,+   5.250 ct\r\n");
      expect(res).not.toBeNull();
      expect(res?.weight).toBe(5.25);
      expect(res?.unit).toBe("ct");
      expect(res?.isStable).toBe(true);
    });

    it("detects negative tare reading -0.050 g", () => {
      const res = parseScaleReading("ST,GS,-   0.050 g\r\n");
      expect(res).not.toBeNull();
      expect(res?.weight).toBeCloseTo(0.05, 3);
      expect(res?.isNegative).toBe(true);
    });

    it("returns null for empty or non-numeric noise lines", () => {
      expect(parseScaleReading("")).toBeNull();
      expect(parseScaleReading("   \r\n")).toBeNull();
      expect(parseScaleReading("ERROR_COMM_TIMEOUT")).toBeNull();
    });
  });

  describe("isWebSerialSupported", () => {
    it("returns boolean according to navigator.serial presence", () => {
      const supported = isWebSerialSupported();
      expect(typeof supported).toBe("boolean");
    });
  });

  describe("MockScaleDriver", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("connects, emits live readings, updates weight, and disconnects", async () => {
      const driver = new MockScaleDriver();
      expect(driver.isConnected()).toBe(false);

      const readings: number[] = [];
      const unsub = driver.onReading((r) => {
        readings.push(r.weight);
      });

      let statusConnected = false;
      const unsubStatus = driver.onStatusChange((conn) => {
        statusConnected = conn;
      });

      await driver.connect(25.5);
      expect(driver.isConnected()).toBe(true);
      expect(statusConnected).toBe(true);

      driver.setWeight(30.125);
      expect(readings.length).toBeGreaterThan(0);
      expect(readings[readings.length - 1]).toBe(30.125);

      await driver.disconnect();
      expect(driver.isConnected()).toBe(false);
      expect(statusConnected).toBe(false);

      unsub();
      unsubStatus();
      vi.useRealTimers();
    });
  });

  describe("ScaleSerialDriver class", () => {
    it("initializes in disconnected state with default 9600 baud rate", () => {
      const driver = new ScaleSerialDriver({ baudRate: 9600 });
      expect(driver.isConnected()).toBe(false);
      expect(driver.getLastReading()).toBeNull();
    });
  });
});
