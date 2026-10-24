import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let buffer: Buffer;
    let modelCode = "MODEL";
    let mimeType = "image/webp";

    if (contentType.includes("application/json")) {
      const json = await req.json();
      const rawDataUrl = json.dataUrl || "";
      modelCode = (json.modelCode || "MODEL").replace(/[^a-zA-Z0-9_-]/g, "_");

      const match = rawDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return NextResponse.json(
          { error: "Yaroqsiz rasm ma'lumotlari (dataUrl talab qilinadi)" },
          { status: 400 }
        );
      }
      mimeType = match[1] || "image/webp";
      buffer = Buffer.from(match[2] || "", "base64");
    } else {
      // Support multipart form-data
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      modelCode = ((formData.get("modelCode") as string) || "MODEL").replace(/[^a-zA-Z0-9_-]/g, "_");

      if (!file) {
        return NextResponse.json({ error: "Fayl yuborilmadi" }, { status: 400 });
      }

      mimeType = file.type || "image/jpeg";
      buffer = Buffer.from(await file.arrayBuffer());
    }

    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: "Rasm ma'lumotlari bo'sh" }, { status: 400 });
    }

    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Rasm hajmi 10 MB dan oshmasligi kerak" }, { status: 400 });
    }

    // Determine extension
    const ext = mimeType.includes("png")
      ? "png"
      : mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? "jpg"
      : "webp";

    const hash = crypto.randomBytes(6).toString("hex");
    const fileName = `${modelCode}_${hash}.${ext}`;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    let publicUrl = `/api/models/photo/${fileName}`;

    if (supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });

      const { error: uploadError } = await supabase.storage
        .from("jewelry-models")
        .upload(fileName, buffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) {
        console.error("Supabase Storage upload error:", uploadError);
        throw new Error(`Storage xatosi: ${uploadError.message}`);
      }

      const { data: urlData } = supabase.storage
        .from("jewelry-models")
        .getPublicUrl(fileName);

      if (urlData?.publicUrl) {
        publicUrl = urlData.publicUrl;
      }
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      fileName,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Rasmni saqlashda xatolik: ${msg}` }, { status: 500 });
  }
}
