import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const STORAGE_DIR = path.resolve(process.cwd(), ".local-pilot-data/storage/models");

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params;
    const safeName = path.basename(filename);

    if (!safeName || safeName.includes("..")) {
      return NextResponse.json({ error: "Yaroqsiz fayl nomi" }, { status: 400 });
    }

    const ext = path.extname(safeName).toLowerCase();
    let mimeType = "image/webp";
    if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
    else if (ext === ".png") mimeType = "image/png";
    else if (ext === ".webp") mimeType = "image/webp";

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // 1. Try fetching from Supabase Storage
    if (supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });

      const { data: fileData, error: downloadError } = await supabase.storage
        .from("jewelry-models")
        .download(safeName);

      if (!downloadError && fileData) {
        const arrayBuf = await fileData.arrayBuffer();
        return new Response(Buffer.from(arrayBuf), {
          status: 200,
          headers: {
            "Content-Type": mimeType,
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
          },
        });
      }
    }

    // 2. Fallback to local filesystem if exists (e.g. local dev)
    const filePath = path.join(STORAGE_DIR, safeName);
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        },
      });
    }

    return NextResponse.json({ error: "Rasm topilmadi" }, { status: 404 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Rasmni yuklashda xatolik: ${msg}` }, { status: 500 });
  }
}
