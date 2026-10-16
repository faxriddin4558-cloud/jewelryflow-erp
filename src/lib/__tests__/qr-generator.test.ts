// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  generateQrMatrix,
  renderMatrixToSvg,
  generateBatchLabelSvg,
  generatePrintableHtml,
  SimulatedThermalPrinterAdapter,
  type BatchLabelData,
} from "../qr-generator";

describe("QR Generator & Industrial Batch Label Engine", () => {
  const sampleBatch: BatchLabelData = {
    batchNo: "BATCH-2026-001",
    productName: "Uzuk Klassika 585",
    proba: 585,
    plannedQty: 25,
    issuedGoldGram: 125.5,
    masterName: "Davron Usta",
    priority: "Urgent",
  };

  it("generates 25x25 boolean matrix with finder patterns", () => {
    const matrix = generateQrMatrix("BATCH-2026-001");
    expect(matrix.length).toBe(25);
    expect(matrix[0]?.length).toBe(25);
    // Top-left finder pattern center should be filled
    expect(matrix[3]?.[3]).toBe(true);
  });

  it("converts matrix to valid SVG string", () => {
    const matrix = generateQrMatrix("TEST");
    const svg = renderMatrixToSvg(matrix, 100);
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox=");
    expect(svg).toContain("</svg>");
  });

  it("generates batch label SVG with all required production fields", () => {
    const labelSvg = generateBatchLabelSvg(sampleBatch, { labelWidthMm: 58, labelHeightMm: 40 });
    expect(labelSvg).toContain("BATCH-2026-001");
    expect(labelSvg).toContain("Uzuk Klassika 585");
    expect(labelSvg).toContain("585");
    expect(labelSvg).toContain("25 DONA");
    expect(labelSvg).toContain("125.50 gr");
  });

  it("generates printable HTML document with @page styling", () => {
    const html = generatePrintableHtml(sampleBatch, { labelWidthMm: 50, labelHeightMm: 30 });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("@page");
    expect(html).toContain("50mm 30mm");
    expect(html).toContain("BATCH-2026-001");
  });

  it("simulated thermal printer adapter queues job and generates valid output", async () => {
    const printer = new SimulatedThermalPrinterAdapter();
    const result = await printer.print(sampleBatch);
    expect(result.success).toBe(true);
    expect(result.driverType).toBe("SIMULATED_THERMAL");
    expect(result.jobId).toContain("JOB-");
    expect(result.renderedSvg).toContain("BATCH-2026-001");
  });
});
