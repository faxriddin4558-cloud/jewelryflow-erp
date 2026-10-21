import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const STORAGE_DIR = path.resolve(process.cwd(), ".local-pilot-data/storage/models");

export async function POST(req: NextRequest) {
  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    const contentType = req.headers.get("content-type") || "";
    let base64Data = "";
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
      base64Data = match[2] || "";
    } else {
      // Support multipart form-data
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      modelCode = ((formData.get("modelCode") as string) || "MODEL").replace(/[^a-zA-Z0-9_-]/g, "_");

      if (!file) {
        return NextResponse.json({ error: "Fayl yuborilmadi" }, { status: 400 });
      }

      mimeType = file.type || "image/jpeg";
      const buffer = Buffer.from(await file.arrayBuffer());
      base64Data = buffer.toString("base64");
    }

    if (!base64Data) {
      return NextResponse.json({ error: "Rasm ma'lumotlari bo'sh" }, { status: 400 });
    }

    // Determine extension
    const ext = mimeType.includes("png")
      ? "png"
      : mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? "jpg"
      : "webp";

    const hash = crypto.randomBytes(6).toString("hex");
    const fileName = `${modelCode}_${hash}.${ext}`;
    const filePath = path.join(STORAGE_DIR, fileName);

    fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));

    const publicUrl = `/api/models/photo/${fileName}`;

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
