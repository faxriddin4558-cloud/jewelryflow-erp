import { describe, it, expect } from "vitest";
import { validateImageFile } from "../image-compression";

describe("Image Compression & Validation Utility", () => {
  it("accepts valid JPEG, PNG, and WebP image files", () => {
    expect(validateImageFile({ type: "image/jpeg", size: 1024 * 500 }).valid).toBe(true);
    expect(validateImageFile({ type: "image/png", size: 1024 * 1024 }).valid).toBe(true);
    expect(validateImageFile({ type: "image/webp", size: 1024 * 200 }).valid).toBe(true);
    expect(validateImageFile({ type: "", size: 1024 * 300, name: "earrings.jpg" }).valid).toBe(true);
  });

  it("rejects non-image file formats", () => {
    const pdfRes = validateImageFile({ type: "application/pdf", size: 50000, name: "doc.pdf" });
    expect(pdfRes.valid).toBe(false);
    expect(pdfRes.error).toContain("Faqat rasm formatidagi fayllar");

    const exeRes = validateImageFile({ type: "application/x-msdownload", size: 1000, name: "app.exe" });
    expect(exeRes.valid).toBe(false);
  });

  it("rejects files exceeding the 10 MB size limit", () => {
    const oversized = validateImageFile({
      type: "image/jpeg",
      size: 15 * 1024 * 1024, // 15 MB
      name: "huge_photo.jpg",
    });
    expect(oversized.valid).toBe(false);
    expect(oversized.error).toContain("juda katta");
  });

  it("handles empty or missing file gracefully", () => {
    // @ts-expect-error test invalid argument
    const res = validateImageFile(null);
    expect(res.valid).toBe(false);
  });
});
