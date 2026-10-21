/**
 * JewelryFlow ERP — Client-Side Image Compression & Validation Utility
 * Compresses camera/gallery photos for fast mobile performance and validates MIME/size.
 */

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

export interface CompressedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB raw camera capture limit
const TARGET_MAX_DIMENSION = 800; // max width or height for mobile ERP thumbnails
const TARGET_QUALITY = 0.82;

/**
 * Validates file MIME type and max raw file size.
 */
export function validateImageFile(file: { type: string; size: number; name?: string }): ImageValidationResult {
  if (!file) {
    return { valid: false, error: "Fayl tanlanmadi!" };
  }

  const rawType = (file.type || "").toLowerCase();
  const isAllowedType = ALLOWED_MIME_TYPES.includes(rawType) ||
    /\.(jpe?g|png|webp)$/i.test(file.name || "");

  if (!isAllowedType) {
    return {
      valid: false,
      error: "Faqat rasm formatidagi fayllar qabul qilinadi (JPEG, PNG, WebP)!",
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Rasm hajmi juda katta (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maksimal hajm: 10 MB!`,
    };
  }

  return { valid: true };
}

/**
 * Resizes and compresses an image to lightweight WebP or JPEG DataURL.
 * Runs in browser environment using HTMLCanvasElement.
 */
export async function compressImageFile(
  file: File,
  maxDimension = TARGET_MAX_DIMENSION,
  quality = TARGET_QUALITY
): Promise<CompressedImageResult> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || "Yaroqsiz rasm fayli");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Faylni o'qishda xatolik yuz berdi"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Rasm ma'lumotlarini yuklab bo'lmadi"));
      img.onload = () => {
        let { width, height } = img;

        // Calculate aspect-preserving dimensions
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Brauzer canvas kontekstini yarata olmadi"));
          return;
        }

        // Draw image smoothly
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        // Attempt WebP, fallback to JPEG
        let dataUrl = canvas.toDataURL("image/webp", quality);
        let mimeType = "image/webp";

        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/jpeg", quality);
          mimeType = "image/jpeg";
        }

        const approxBytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);

        resolve({
          dataUrl,
          width,
          height,
          mimeType,
          sizeBytes: approxBytes,
        });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
