import { describe, it, expect } from "vitest";
import {
  parseCsvLines,
  detectSheetSchema,
  validateAndMapSheetsRows,
  calculateSheetsImportSummary,
} from "../sheets-import-engine";

describe("Google Sheets Migration & Parity Engine", () => {
  describe("CSV Parsing (Multi-delimiter & Quoting)", () => {
    it("parses comma-separated values with quoted fields", () => {
      const csv = `Sana,Mahsulot,"Vazn, g",Proba\n2026-02-01,"Sirg'a, Dorika",15.5000,585`;
      const rows = parseCsvLines(csv);
      expect(rows.length).toBe(2);
      expect(rows[0]).toEqual(["Sana", "Mahsulot", "Vazn, g", "Proba"]);
      expect(rows[1]).toEqual(["2026-02-01", "Sirg'a, Dorika", "15.5000", "585"]);
    });

    it("parses semicolon-separated values (common in Uzbek/Russian Excel exports)", () => {
      const csv = `Sana;Kirim;Chiqish;Izoh\n2026-02-01;100.5;92.4;Afinaj`;
      const rows = parseCsvLines(csv);
      expect(rows.length).toBe(2);
      expect(rows[0]).toEqual(["Sana", "Kirim", "Chiqish", "Izoh"]);
      expect(rows[1]).toEqual(["2026-02-01", "100.5", "92.4", "Afinaj"]);
    });
  });

  describe("Schema Detection", () => {
    it("detects 'Zavod bilan' schema correctly", () => {
      const schema = detectSheetSchema("Zavod bilan");
      expect(schema.name).toBe("Zavod bilan");
      expect(schema.requiredColumns).toContain("weight");
    });

    it("detects 'Tovar olish' schema correctly", () => {
      const schema = detectSheetSchema("Tovar olish");
      expect(schema.name).toBe("Tovar olish");
      expect(schema.requiredColumns).toContain("cash_amount");
    });

    it("detects 'Lom pateriya' schema correctly", () => {
      const schema = detectSheetSchema("Lom pateriya");
      expect(schema.name).toBe("Lom pateriya");
      expect(schema.requiredColumns).toContain("scrap_weight");
    });

    it("detects seller sheets ('Sanatoni sotuv', 'Otush sotuv', 'Buxoro sotuv')", () => {
      const s1 = detectSheetSchema("Sanatoni sotuv");
      const s2 = detectSheetSchema("Otush sotuv");
      const s3 = detectSheetSchema("Buxoro sotuv");
      expect(s1.name).toBe("Sanatoni sotuv");
      expect(s2.name).toBe("Otush sotuv");
      expect(s3.name).toBe("Buxoro sotuv");
    });
  });

  describe("Validation & Mapping for 'Zavod bilan'", () => {
    const csv = `Sana,Mahsulot nomi,Sof ogirlik (g),Proba,Ustama %,Zavod qarzi (g),Izoh
2026-02-01,Zanjir Bismark,100.0000,585,8.00,108.0000,1-partiya
2026-02-05,Sirg'a Dorika,50.0000,585,8.00,54.0000,2-partiya`;

    it("validates and calculates summary for valid factory rows", () => {
      const { rows } = validateAndMapSheetsRows(csv, "Zavod bilan", false);
      expect(rows.length).toBe(2);
      expect(rows[0]!.is_valid).toBe(true);
      expect(rows[0]!.mapped.weight).toBe(100);
      expect(rows[0]!.mapped.markup_pct).toBe(8);
      expect(rows[0]!.mapped.factory_gold_due).toBe(108);

      const summary = calculateSheetsImportSummary(rows);
      expect(summary.total_rows).toBe(2);
      expect(summary.valid_rows).toBe(2);
      expect(summary.skipped_rows).toBe(0);
      expect(summary.total_weight_g).toBe(150);
    });

    it("flags invalid numbers or missing required columns", () => {
      const invalidCsv = `Sana,Mahsulot nomi,Sof ogirlik (g),Proba
2026-02-01,Zanjir,NOT_A_NUMBER,585
,Sirg'a,50.0000,585`;

      const { rows } = validateAndMapSheetsRows(invalidCsv, "Zavod bilan", false);
      expect(rows.length).toBe(2);
      expect(rows[0]!.is_valid).toBe(false);
      expect(rows[0]!.errors.some((e) => e.includes("og'irlik"))).toBe(true);
      expect(rows[1]!.is_valid).toBe(false);
      expect(rows[1]!.errors.some((e) => e.includes("Sana"))).toBe(true);
    });
  });

  describe("Validation for 'Tovar olish' (Cash Gold Purchase)", () => {
    const csv = `Sana,Taminotchi,Tolangan naqd pul (UZS),Gramm kursi (UZS),Olingan vazn (g),Proba,Izoh
2026-02-02,Chorsu Bozor,90000000,900000,100.0000,585,Naqdga xarid`;

    it("maps cash amount, gold rate, and weight correctly", () => {
      const { rows } = validateAndMapSheetsRows(csv, "Tovar olish", false);
      expect(rows.length).toBe(1);
      expect(rows[0]!.is_valid).toBe(true);
      expect(rows[0]!.mapped.cash_amount).toBe(90000000);
      expect(rows[0]!.mapped.rate).toBe(900000);
      expect(rows[0]!.mapped.weight).toBe(100);

      const summary = calculateSheetsImportSummary(rows);
      expect(summary.total_cash_amount).toBe(90000000);
      expect(summary.total_weight_g).toBe(100);
    });
  });

  describe("Validation for 'Lom pateriya' (Refining)", () => {
    const csv = `Sana,Kirim lom (g),Erigan vazn (g),Chiqish sof oltin (g),Sof proba,Pateriya (g),Izoh
2026-02-03,200.0000,198.5000,116.8000,995,1.5000,Afinaj`;

    it("maps refining scrap input, melted weight, fine output, and loss correctly", () => {
      const { rows } = validateAndMapSheetsRows(csv, "Lom pateriya", false);
      expect(rows.length).toBe(1);
      expect(rows[0]!.is_valid).toBe(true);
      expect(rows[0]!.mapped.scrap_weight).toBe(200);
      expect(rows[0]!.mapped.melted_weight).toBe(198.5);
      expect(rows[0]!.mapped.fine_weight).toBe(116.8);
      expect(rows[0]!.mapped.loss_weight).toBe(1.5);
    });
  });

  describe("Opening Balance Mode", () => {
    const csv = `Sana,Turi,Nomi,585 Lom vazn (g),Naqd summa (UZS),Zavod qarzi (g),Bozor qarzi (g),Izoh
2026-01-01,Zavod qarzi,Zavod Bosh Qarzi,0,0,108.0000,0,Zavod boshlangich
2026-01-01,Sotuvchi qarzi,Jamshid,0,0,0,-15.5000,Jamshid qoldiq`;

    it("accepts opening balances with negative or positive signed debts", () => {
      const { rows } = validateAndMapSheetsRows(csv, "opening_balances", true);
      expect(rows.length).toBe(2);
      expect(rows[0]!.is_valid).toBe(true);
      expect(rows[1]!.is_valid).toBe(true);
      expect(rows[1]!.mapped.seller_debt).toBe(-15.5);
    });
  });

});
