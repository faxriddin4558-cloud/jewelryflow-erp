export type SheetType =
  | "Zavod bilan"
  | "Tovar olish"
  | "Lom pateriya"
  | "Sanatoni sotuv"
  | "Otush sotuv"
  | "Buxoro sotuv"
  | "opening_balances";

export interface SheetSchemaDefinition {
  name: SheetType;
  requiredColumns: string[];
  description: string;
}

export const SHEET_SCHEMAS: Record<string, SheetSchemaDefinition> = {
  "Zavod bilan": {
    name: "Zavod bilan",
    requiredColumns: ["date", "weight"],
    description: "Zavoddan tovar kirimi (585g + 8% ustama)",
  },
  "Tovar olish": {
    name: "Tovar olish",
    requiredColumns: ["date", "cash_amount", "weight"],
    description: "Naqd pulga oltin sotib olish",
  },
  "Lom pateriya": {
    name: "Lom pateriya",
    requiredColumns: ["date", "scrap_weight"],
    description: "Lom eritish, afinaj va pateriya hisobi",
  },
  "Sanatoni sotuv": {
    name: "Sanatoni sotuv",
    requiredColumns: ["date", "weight"],
    description: "Jamshid sotuvchi savdolari",
  },
  "Otush sotuv": {
    name: "Otush sotuv",
    requiredColumns: ["date", "weight"],
    description: "Dilshod sotuvchi savdolari",
  },
  "Buxoro sotuv": {
    name: "Buxoro sotuv",
    requiredColumns: ["date", "weight"],
    description: "Jasur sotuvchi savdolari",
  },
  "opening_balances": {
    name: "opening_balances",
    requiredColumns: ["date"],
    description: "Boshlang'ich qoldiqlar (Zavod, sotuvchilar, mijozlar, kassa)",
  },
};

export function detectSheetSchema(sheetName: string): SheetSchemaDefinition {
  const normalized = sheetName.trim();
  if (SHEET_SCHEMAS[normalized]) {
    return SHEET_SCHEMAS[normalized];
  }
  // Case-insensitive / partial match
  const lower = normalized.toLowerCase();
  for (const [key, schema] of Object.entries(SHEET_SCHEMAS)) {
    if (lower.includes(key.toLowerCase())) {
      return schema;
    }
  }
  return {
    name: "Zavod bilan",
    requiredColumns: ["date", "weight"],
    description: "Standart zavod jurnali",
  };
}

/**
 * Split CSV text into rows of string arrays handling commas, semicolons, and quotes.
 */
export function parseCsvLines(csvText: string): string[][] {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const firstLine = lines[0] || "";
  let delimiter = ",";
  if (firstLine.includes("\t")) delimiter = "\t";
  else if (firstLine.includes(";") && !firstLine.includes(",")) delimiter = ";";

  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  return lines.map((l) => splitLine(l).map((cell) => cell.replace(/^"|"$/g, "").trim()));
}

/**
 * Standard CSV parser returning headers and array of row records.
 */
export function parseCsvText(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const lineArrays = parseCsvLines(csvText);
  if (lineArrays.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = lineArrays[0] || [];
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lineArrays.length; i++) {
    const values = lineArrays[i] || [];
    const rowObj: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowObj[header] = values[index] || "";
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}

/**
 * Normalize date to YYYY-MM-DD.
 */
function normalizeDate(rawDate?: string): string | null {
  if (!rawDate) return null;
  const cleaned = rawDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const dmyMatch = cleaned.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
    const d = dmyMatch[1];
    const m = dmyMatch[2];
    const y = dmyMatch[3];
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    const iso = parsed.toISOString().split("T")[0];
    return iso || null;
  }
  return null;
}


/**
 * Parse numeric values safely (handles commas, spaces, negative numbers).
 */
function parseNumber(val?: string): number {
  if (!val) return 0;
  const sanitized = val.replace(/\s+/g, "").replace(/,/g, ".");
  const num = parseFloat(sanitized);
  return isNaN(num) ? 0 : num;
}

export interface ValidatedRowItem {
  line_number: number;
  is_valid: boolean;
  errors: string[];
  raw: Record<string, string>;
  mapped: {
    date?: string;
    product_name?: string;
    weight?: number;
    proba?: number;
    markup_pct?: number;
    factory_gold_due?: number;
    cash_amount?: number;
    rate?: number;
    scrap_weight?: number;
    melted_weight?: number;
    fine_weight?: number;
    loss_weight?: number;
    seller_debt?: number;
    notes?: string;
    [key: string]: unknown;
  };
}

export interface SheetsSummaryResult {
  total_rows: number;
  valid_rows: number;
  skipped_rows: number;
  total_weight_g: number;
  total_cash_amount: number;
}

export function calculateSheetsImportSummary(rows: ValidatedRowItem[]): SheetsSummaryResult {
  let valid_rows = 0;
  let skipped_rows = 0;
  let total_weight_g = 0;
  let total_cash_amount = 0;

  for (const r of rows) {
    if (r.is_valid) {
      valid_rows++;
      const w = Number(r.mapped.weight || r.mapped.scrap_weight || 0);
      const c = Number(r.mapped.cash_amount || 0);
      total_weight_g += w;
      total_cash_amount += c;
    } else {
      skipped_rows++;
    }
  }

  return {
    total_rows: rows.length,
    valid_rows,
    skipped_rows,
    total_weight_g: Number(total_weight_g.toFixed(4)),
    total_cash_amount: Number(total_cash_amount.toFixed(2)),
  };
}

export function validateAndMapSheetsRows(
  csvText: string,
  sheetName: string,
  isOpeningBalance: boolean = false
): {
  rows: ValidatedRowItem[];
  columnMapping: Record<string, string>;
  schema: SheetSchemaDefinition;
} {
  const schema = detectSheetSchema(sheetName);
  const { headers, rows: rawRows } = parseCsvText(csvText);

  const columnMapping: Record<string, string> = {};
  headers.forEach((h) => {
    const lower = h.toLowerCase();
    if (lower.includes("sana") || lower.includes("date")) columnMapping[h] = "date";
    else if (lower.includes("vazn") || lower.includes("ogirlik") || lower.includes("weight")) columnMapping[h] = "weight";
    else if (lower.includes("proba")) columnMapping[h] = "proba";
    else if (lower.includes("ustama") || lower.includes("foiz") || lower.includes("%")) columnMapping[h] = "markup_pct";
    else if (lower.includes("pul") || lower.includes("naqd") || lower.includes("summa")) columnMapping[h] = "cash_amount";
    else if (lower.includes("kurs") || lower.includes("narx")) columnMapping[h] = "rate";
    else columnMapping[h] = h;
  });

  const validatedRows: ValidatedRowItem[] = [];

  rawRows.forEach((row, idx) => {
    const line_number = idx + 2;
    const errors: string[] = [];
    const keys = Object.keys(row);

    const findVal = (keywords: string[]): string => {
      for (const k of keys) {
        const lower = k.toLowerCase();
        if (keywords.some((kw) => lower.includes(kw))) {
          return row[k] ?? "";
        }
      }
      return "";

    };

    const rawDate = findVal(["sana", "date", "kun", "время"]);
    const rawScrap = findVal(["kirim lom", "lom kirim", "kirim", "scrap"]);
    const rawWeight = findVal(["vazn", "ogirlik", "weight", "ves", "вес", "kiruvchi"]);
    const rawProba = findVal(["proba", "probasi", "проба"]);
    const rawMarkup = findVal(["ustama", "foiz", "foizi", "markup", "percent", "%"]);
    const rawProduct = findVal(["nomi", "mahsulot", "product", "tovar", "модель"]);
    const rawCash = findVal(["pul", "naqd", "summa", "cash", "uzs"]);
    const rawRate = findVal(["kurs", "narx", "rate"]);
    const rawMelted = findVal(["erigan", "eritilgan", "melted"]);
    const rawFine = findVal(["toza", "chiqish", "fine", "sof"]);
    const rawLoss = findVal(["pateriya", "loss", "yo'qotish"]);
    const rawSellerDebt = findVal(["bozor", "sotuvchi qarzi"]);
    const rawNotes = findVal(["izoh", "eslatma", "notes"]);

    // Date validation
    const date = normalizeDate(rawDate);
    if (!date) {
      errors.push("Sana maydoni bo'sh yoki noto'g'ri formatda");
    }

    // Weight validation
    let weight = 0;
    const effectiveWeightRaw = rawScrap || rawWeight;
    if (effectiveWeightRaw) {
      weight = parseNumber(effectiveWeightRaw);
      if (isNaN(weight) || (weight <= 0 && !isOpeningBalance && schema.requiredColumns.includes("weight"))) {
        errors.push("Sof og'irlik (vazn) musbat son bo'lishi shart");
      }
    } else if (schema.requiredColumns.includes("weight") && !isOpeningBalance) {
      errors.push("Sof og'irlik (vazn) ustuni topilmadi yoki bo'sh");
    }


    // Proba
    const proba = parseNumber(rawProba) || (schema.name === "Lom pateriya" ? 995 : 585);

    // Markup
    let markupPct = parseNumber(rawMarkup);
    if (markupPct === 0) {
      markupPct = schema.name === "Zavod bilan" ? 8.0 : 12.0;
    }

    // Cash amount
    const cashAmount = parseNumber(rawCash);
    if (schema.requiredColumns.includes("cash_amount") && cashAmount <= 0) {
      errors.push("To'langan naqd summa musbat son bo'lishi shart");
    }

    // Rate
    const rate = parseNumber(rawRate) || 900000;

    // Factory gold due
    const factoryGoldDue = Number((weight * (1 + markupPct / 100)).toFixed(4));

    // Refining
    const scrapWeight = parseNumber(rawScrap || rawWeight);
    if (schema.requiredColumns.includes("scrap_weight") && scrapWeight <= 0) {
      errors.push("Kirim lom vazni musbat son bo'lishi shart");
    }
    const meltedWeight = parseNumber(rawMelted);
    const fineWeight = parseNumber(rawFine);
    const lossWeight = parseNumber(rawLoss);

    // Opening balances
    const sellerDebt = parseNumber(rawSellerDebt);

    const isValid = errors.length === 0;

    validatedRows.push({
      line_number,
      is_valid: isValid,
      errors,
      raw: row,
      mapped: {
        date: date || "",
        product_name: rawProduct || "Zargarlik buyumi",
        weight,
        proba,
        markup_pct: markupPct,
        factory_gold_due: factoryGoldDue,
        cash_amount: cashAmount,
        rate,
        scrap_weight: scrapWeight,
        melted_weight: meltedWeight,
        fine_weight: fineWeight,
        loss_weight: lossWeight,
        seller_debt: sellerDebt,
        notes: rawNotes || "",
      },
    });
  });

  return {
    rows: validatedRows,
    columnMapping,
    schema,
  };
}

export interface ParsedSheetRow {
  rowIndex: number;
  date: string;
  productName?: string;
  weightG: number;
  proba: number;
  markupPct: number;
  cashAmountUzs?: number;
  ratePerGram?: number;
  supplierName?: string;
  inputScrapG?: number;
  meltedG?: number;
  outputFineG?: number;
  fineProba?: number;
  notes?: string;
  raw: Record<string, string>;
}

export interface SheetValidationError {
  rowIndex: number;
  field: string;
  message: string;
  raw: Record<string, string>;
}

export interface SheetValidationResult {
  sheetType: SheetType;
  isValid: boolean;
  totalRows: number;
  validRows: ParsedSheetRow[];
  errors: SheetValidationError[];
  duplicateRowsCount: number;
  summary: {
    totalWeightG: number;
    totalCashUzs: number;
    calculatedObligationG: number;
  };
}

export function validateSheetsData(
  sheetType: SheetType,
  rows: Record<string, string>[],
  isOpeningBalance: boolean = false
): SheetValidationResult {
  // Backwards compatibility layer
  const firstRow = rows.length > 0 ? rows[0] : null;
  const csvHeaders = firstRow ? Object.keys(firstRow).join(",") : "";
  const csvBody = rows.map((r) => Object.values(r).join(",")).join("\n");

  const fullCsv = `${csvHeaders}\n${csvBody}`;

  const mapped = validateAndMapSheetsRows(fullCsv, sheetType, isOpeningBalance);
  const summary = calculateSheetsImportSummary(mapped.rows);

  const validRows: ParsedSheetRow[] = mapped.rows
    .filter((r) => r.is_valid)
    .map((r) => ({
      rowIndex: r.line_number,
      date: String(r.mapped.date || ""),
      productName: String(r.mapped.product_name || ""),
      weightG: Number(r.mapped.weight || 0),
      proba: Number(r.mapped.proba || 585),
      markupPct: Number(r.mapped.markup_pct || 0),
      cashAmountUzs: Number(r.mapped.cash_amount || 0),
      ratePerGram: Number(r.mapped.rate || 900000),
      inputScrapG: Number(r.mapped.scrap_weight || 0),
      meltedG: Number(r.mapped.melted_weight || 0),
      outputFineG: Number(r.mapped.fine_weight || 0),
      notes: String(r.mapped.notes || ""),
      raw: r.raw,
    }));

  const errors: SheetValidationError[] = mapped.rows
    .filter((r) => !r.is_valid)
    .flatMap((r) =>
      r.errors.map((msg) => ({
        rowIndex: r.line_number,
        field: "general",
        message: msg,
        raw: r.raw,
      }))
    );

  return {
    sheetType,
    isValid: errors.length === 0,
    totalRows: mapped.rows.length,
    validRows,
    errors,
    duplicateRowsCount: 0,
    summary: {
      totalWeightG: summary.total_weight_g,
      totalCashUzs: summary.total_cash_amount,
      calculatedObligationG: Number((summary.total_weight_g * 1.08).toFixed(4)),
    },
  };
}
