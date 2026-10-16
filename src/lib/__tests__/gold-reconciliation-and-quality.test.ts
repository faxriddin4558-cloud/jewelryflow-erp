import { describe, it, expect } from "vitest";
import { GoldEngine } from "../erp-engine";
import {
  generateQrMatrix,
  generateBatchLabelSvg,
  generatePrintableHtml,
  SimulatedThermalPrinterAdapter,
} from "../qr-generator";
import { evaluateQcInspection, DEFECT_CATALOG } from "../quality-control";

describe("GoldEngine.auditFactoryIntegrity", () => {
  it("passes cleanly on healthy factory data without leakage", () => {
    const report = GoldEngine.auditFactoryIntegrity({
      inv: [
        { id: "inv-1", name: "Oltin 585", category: "Gold", proba: 585, on_hand: 500, reserved: 100 },
        { id: "inv-2", name: "Oltin 999", category: "Gold", proba: 999, on_hand: 200, reserved: 0 },
      ],
      batches: [
        {
          id: "b-1",
          batch_no: "BATCH-001",
          issued_gold_gram: 100,
          good_output_gram: 85,
          sprue_gram: 10,
          scrap_gram: 4.8,
          loss_gram: 0.2,
          wip_gram: 0,
          status: "COMPLETED",
        },
      ],
      handovers: [
        { id: "h-1", batch_no: "BATCH-001", status: "ACCEPTED", weight_discrepancy_gram: 0.01 },
      ],
      sales: [{ id: "s-1", total_amount: 10000000, paid_amount: 6000000, debt_amount: 4000000 }],
      products: [{ id: "p-1", name: "Uzuk", stock: 10, weight: 4.5, stone_weight: 0.5 }],
    });

    expect(report.isHealthy).toBe(true);
    expect(report.anomalies.filter((a) => a.severity === "CRITICAL").length).toBe(0);
    expect(report.totalGoldIssuedGram).toBe(100);
    expect(report.totalGoldAccountedGram).toBe(100);
    expect(report.unaccountedGoldLeakGram).toBe(0);
  });

  it("detects critical anomalies when inventory is negative or over-reserved", () => {
    const report = GoldEngine.auditFactoryIntegrity({
      inv: [
        { id: "inv-neg", name: "Manfiy Oltin", category: "Gold", proba: 585, on_hand: -15, reserved: 0 },
        { id: "inv-over", name: "Ortiqcha Rezerv", category: "Gold", proba: 585, on_hand: 50, reserved: 80 },
      ],
    });

    expect(report.isHealthy).toBe(false);
    const criticals = report.anomalies.filter((a) => a.severity === "CRITICAL");
    expect(criticals.length).toBe(2);
    expect(criticals.some((a) => a.description.includes("manfiy qoldiq"))).toBe(true);
    expect(criticals.some((a) => a.description.includes("oshib ketgan"))).toBe(true);
  });

  it("detects mass balance generation defect when output exceeds issued gold", () => {
    const report = GoldEngine.auditFactoryIntegrity({
      batches: [
        {
          id: "b-defect",
          batch_no: "BATCH-SUSPECT",
          issued_gold_gram: 100,
          good_output_gram: 110, // 110 > 100 !
          sprue_gram: 10,
          scrap_gram: 5,
          loss_gram: 0,
          status: "COMPLETED",
        },
      ],
    });

    expect(report.isHealthy).toBe(false);
    expect(report.anomalies.some((a) => a.category === "MASS_BALANCE" && a.severity === "CRITICAL")).toBe(true);
  });

  it("flags handover discrepancies waiting for supervisor override", () => {
    const report = GoldEngine.auditFactoryIntegrity({
      handovers: [
        {
          id: "h-flagged",
          batch_no: "BATCH-FLAGGED",
          status: "DISCREPANCY_FLAGGED",
          weight_discrepancy_gram: 0.12, // 0.12 > 0.05
        },
      ],
    });

    expect(report.anomalies.some((a) => a.category === "HANDOVER" && a.description.includes("vazn farqi"))).toBe(true);
  });

  it("detects payroll duplicate earnings on the same batch and stage", () => {
    const report = GoldEngine.auditFactoryIntegrity({
      salaryLedger: [
        { id: "sal-1", employee_id: "emp-1", batch_no: "B-001", stage_name: "Casting", tx_type: "EARNED" },
        { id: "sal-2", employee_id: "emp-1", batch_no: "B-001", stage_name: "Casting", tx_type: "EARNED" },
      ],
    });

    expect(report.anomalies.some((a) => a.category === "PAYROLL" && a.description.includes("takroriy"))).toBe(true);
  });

  it("detects critical payroll anomaly when adjustments exceed original earned amount", () => {
    const report = GoldEngine.auditFactoryIntegrity({
      salaryLedger: [
        { id: "sal-100", employee_id: "emp-1", worker_name: "Usta", amount: 100000, tx_type: "EARNED" },
        { id: "sal-101", original_ledger_id: "sal-100", amount: 70000, tx_type: "ADJUSTMENT" },
        { id: "sal-102", original_ledger_id: "sal-100", amount: 50000, tx_type: "ADJUSTMENT" }, // 70k + 50k = 120k > 100k!
      ],
    });

    expect(report.isHealthy).toBe(false);
    expect(
      report.anomalies.some(
        (a) => a.category === "PAYROLL" && a.severity === "CRITICAL" && a.description.includes("ortiqcha ushlab qolingan")
      )
    ).toBe(true);
  });
});

describe("QR Code & Batch Label Engine (Printer-Independent)", () => {
  it("generates a valid 25x25 QR matrix with finder patterns", () => {
    const matrix = generateQrMatrix("BATCH-001");
    expect(matrix.length).toBe(25);
    expect(matrix[0]?.length).toBe(25);
    // Top-left finder pattern corner check
    expect(matrix[0]?.[0]).toBe(true);
    expect(matrix[0]?.[6]).toBe(true);
  });

  it("generates an SVG label containing batch identification and probe", () => {
    const svg = generateBatchLabelSvg({
      batchNo: "BATCH-001",
      productName: "Uzuk Klassika 585",
      proba: 585,
      plannedQty: 20,
      issuedGoldGram: 52.0,
      priority: "URGENT",
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain("BATCH-001");
    expect(svg).toContain("PROBA: 585");
    expect(svg).toContain("URGENT");
    expect(svg).toContain("GOLDIA FACTORY");
  });

  it("simulated printer driver renders labels without hardware errors", async () => {
    const driver = new SimulatedThermalPrinterAdapter();
    const result = await driver.print({
      batchNo: "BATCH-002",
      productName: "Sirga Kast 585",
      proba: 585,
      plannedQty: 15,
      issuedGoldGram: 48.5,
    });

    expect(result.success).toBe(true);
    expect(result.jobId.startsWith("JOB-")).toBe(true);
    expect(result.driverType).toBe("SIMULATED_THERMAL");
    expect(result.renderedSvg).toContain("BATCH-002");
  });

  it("generates standard browser-printable HTML document with page formatting", () => {
    const html = generatePrintableHtml({
      batchNo: "BATCH-PRINT-01",
      productName: "Zanjir Italy 750",
      proba: 750,
      plannedQty: 10,
      issuedGoldGram: 92.0,
      masterName: "Usta Jasur",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("@page");
    expect(html).toContain("onload=\"window.print()\"");
    expect(html).toContain("BATCH-PRINT-01");
    expect(html).toContain("Zanjir Italy 750");
  });
});

describe("Quality Control & Defect Routing Engine", () => {
  it("passes clean inspections with 100% pass rate", () => {
    const res = evaluateQcInspection({
      batchNo: "BATCH-001",
      operationName: "Yakuniy QC",
      checkedQty: 20,
      passedQty: 20,
      reworkQty: 0,
      inspectorName: "QC Nazoratchi",
    });

    expect(res.isPassed).toBe(true);
    expect(res.passRatePercentage).toBe(100);
    expect(res.reworkActionRecommended).toBeNull();
  });

  it("routes casting porosity defects to recommended casting rework stage", () => {
    const res = evaluateQcInspection({
      batchNo: "BATCH-001",
      operationName: "QC Nazorati",
      checkedQty: 20,
      passedQty: 18,
      reworkQty: 2,
      defectCategory: "CASTING_POROSITY",
      inspectorName: "Nazoratchi",
      defectReason: "G'ovaklik aniqlandi",
    });

    expect(res.isPassed).toBe(false);
    expect(res.passRatePercentage).toBe(90);
    expect(res.reworkActionRecommended).toContain(DEFECT_CATALOG.CASTING_POROSITY.recommendedReworkStage);
    expect(res.reworkActionRecommended).toContain("Quyish g'ovakligi");
  });

  it("rejects invalid inspection numbers", () => {
    expect(() =>
      evaluateQcInspection({
        batchNo: "BATCH-001",
        operationName: "QC",
        checkedQty: 10,
        passedQty: 8,
        reworkQty: 5, // 8 + 5 = 13 > 10 !
        inspectorName: "Nazoratchi",
      })
    ).toThrow();
  });
});
