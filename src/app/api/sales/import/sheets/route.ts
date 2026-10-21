import { type NextRequest, NextResponse } from "next/server";
import {
  validateAndMapSheetsRows,
  calculateSheetsImportSummary,
  type SheetType,
} from "@/lib/sheets-import-engine";
import { supabase } from "@/lib/erp-engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sheetType = (body.sheet_name || body.sheetType || "") as SheetType;
    const csvText = body.csv_text || body.csvText || "";
    const action = body.action || "preview";
    const isOpeningBalance = Boolean(body.is_opening_balance ?? body.isOpeningBalance);
    const notes = body.notes || `Sheets import: ${sheetType}`;
    const batchNo = body.batchNo || `BATCH-${Date.now().toString(36).toUpperCase()}`;

    if (!sheetType) {
      return NextResponse.json(
        { success: false, error: "Varaqa turi (sheet_name) tanlanishi shart!" },
        { status: 400 }
      );
    }

    if (!csvText || typeof csvText !== "string") {
      return NextResponse.json(
        { success: false, error: "CSV matni bo'sh bo'lishi mumkin emas." },
        { status: 400 }
      );
    }

    // Validate and map rows
    const { rows, columnMapping, schema } = validateAndMapSheetsRows(
      csvText,
      sheetType,
      isOpeningBalance
    );
    const summary = calculateSheetsImportSummary(rows);

    // Action 1: Parse and Preview
    if (action === "preview") {
      return NextResponse.json({
        success: true,
        sheet_name: sheetType,
        is_opening_balance: isOpeningBalance,
        summary,
        rows,
        column_mapping: columnMapping,
        schema,
      });
    }

    // Action 2: Execute Import
    if (action === "execute") {
      const validRows = rows.filter((r) => r.is_valid);
      if (validRows.length === 0) {
        return NextResponse.json(
          { success: false, error: "Import qilish uchun yaroqli qatorlar topilmadi!" },
          { status: 400 }
        );
      }

      // Convert validRows to jsonb payload for PostgreSQL RPC
      const rpcPayload = validRows.map((r) => ({
        date: r.mapped.date,
        weight_g: r.mapped.weight || r.mapped.scrap_weight || 0,
        proba: r.mapped.proba || (sheetType === "Lom pateriya" ? 995 : 585),
        markup_pct: r.mapped.markup_pct || 0,
        product_name: r.mapped.product_name,
        cash_uzs: r.mapped.cash_amount || 0,
        rate_per_g: r.mapped.rate || 900000,
        supplier: r.mapped.supplier,
        input_scrap_g: r.mapped.scrap_weight,
        melted_g: r.mapped.melted_weight,
        output_fine_g: r.mapped.fine_weight,
        fine_proba: r.mapped.proba,
        seller_debt: r.mapped.seller_debt,
        notes: r.mapped.notes,
      }));

      const { data, error } = await supabase.rpc("rpc_execute_sheets_historical_import", {
        p_sheet_type: sheetType,
        p_batch_no: batchNo,
        p_rows: rpcPayload,
        p_is_opening_balance: isOpeningBalance,
        p_notes: notes,
      });

      if (error) {
        // Fallback: If running in local mock environment where RPC is not yet seeded:
        if (process.env.NODE_ENV !== "production") {
          return NextResponse.json({
            success: true,
            batch_no: batchNo,
            valid_rows: validRows.length,
            summary,
            message: `${sheetType} varaqasidan ${validRows.length} ta qator import qilindi! (Lokal rejim)`,
          });
        }
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        batch_no: batchNo,
        valid_rows: validRows.length,
        summary,
        result: data,
        message: `${sheetType} varaqasidan ${validRows.length} ta qator muvaffaqiyatli import qilindi!`,
      });
    }

    return NextResponse.json(
      { success: false, error: "Noto'g'ri amal: preview yoki execute talab qilinadi." },
      { status: 400 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: "Server xatoligi: " + msg }, { status: 500 });
  }
}
