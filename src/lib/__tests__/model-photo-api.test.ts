import { describe, it, expect, afterAll } from "vitest";
import { POST } from "@/app/api/models/photo/route";
import { GET } from "@/app/api/models/photo/[filename]/route";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

const STORAGE_DIR = path.resolve(process.cwd(), ".local-pilot-data/storage/models");

describe("Jewelry Model Photos API", () => {
  const sample1x1PngBase64 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEfgHzp9B5tAAAAABJRU5ErkJggg==";

  let uploadedFileName = "";
  let uploadedUrl = "";

  it("POST /api/models/photo validates and stores compressed photo", async () => {
    const req = new NextRequest("http://localhost:3000/api/models/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataUrl: sample1x1PngBase64,
        modelCode: "JF-M-9999",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.url).toMatch(/^\/api\/models\/photo\/JF-M-9999_[a-f0-9]+\.png$/);
    expect(json.fileName).toContain("JF-M-9999");

    uploadedFileName = json.fileName;
    uploadedUrl = json.url;

    // Verify file exists on disk in storage dir
    const diskPath = path.join(STORAGE_DIR, uploadedFileName);
    expect(fs.existsSync(diskPath)).toBe(true);
  });

  it("GET /api/models/photo/[filename] serves stored photo with proper cache headers", async () => {
    expect(uploadedFileName).toBeTruthy();

    const req = new NextRequest(`http://localhost:3000${uploadedUrl}`);
    const res = await GET(req, {
      params: Promise.resolve({ filename: uploadedFileName }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("public");

    const arrayBuf = await res.arrayBuffer();
    expect(arrayBuf.byteLength).toBeGreaterThan(0);
  });

  it("GET /api/models/photo/[filename] protects against path traversal", async () => {
    const req = new NextRequest("http://localhost:3000/api/models/photo/../../secret.txt");
    const res = await GET(req, {
      params: Promise.resolve({ filename: "../../secret.txt" }),
    });

    // path.basename isolates the name, file won't exist
    expect([400, 404]).toContain(res.status);
  });

  it("GET /api/models/photo/[filename] returns 404 for non-existent image", async () => {
    const req = new NextRequest("http://localhost:3000/api/models/photo/non_existent.jpg");
    const res = await GET(req, {
      params: Promise.resolve({ filename: "non_existent_99999.jpg" }),
    });

    expect(res.status).toBe(404);
  });

  afterAll(() => {
    // Clean up test image
    if (uploadedFileName) {
      const diskPath = path.join(STORAGE_DIR, uploadedFileName);
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
      }
    }
  });
});
