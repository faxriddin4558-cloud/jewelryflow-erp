const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SOURCE_IMAGE = path.resolve('C:/Users/quettabyte/.gemini/antigravity/brain/408d0a5d-b09c-4e53-a442-b92b1ab8742c/.user_uploaded/media_1792829805954_e3ad525c.jpg');
const PUBLIC_DIR = path.resolve(__dirname, '../public');

async function generateIcons() {
  console.log('Generating Goldia Sales PWA icons from:', SOURCE_IMAGE);
  if (!fs.existsSync(SOURCE_IMAGE)) {
    throw new Error(`Source image not found at ${SOURCE_IMAGE}`);
  }

  // 1. icon-192x192.png
  await sharp(SOURCE_IMAGE)
    .resize(192, 192, { fit: 'contain', background: { r: 12, g: 30, b: 22, alpha: 1 } })
    .png()
    .toFile(path.join(PUBLIC_DIR, 'icon-192x192.png'));
  console.log('✅ Generated public/icon-192x192.png');

  // 2. icon-512x512.png
  await sharp(SOURCE_IMAGE)
    .resize(512, 512, { fit: 'contain', background: { r: 12, g: 30, b: 22, alpha: 1 } })
    .png()
    .toFile(path.join(PUBLIC_DIR, 'icon-512x512.png'));
  console.log('✅ Generated public/icon-512x512.png');

  // 3. apple-touch-icon.png (180x180)
  await sharp(SOURCE_IMAGE)
    .resize(180, 180, { fit: 'contain', background: { r: 12, g: 30, b: 22, alpha: 1 } })
    .png()
    .toFile(path.join(PUBLIC_DIR, 'apple-touch-icon.png'));
  console.log('✅ Generated public/apple-touch-icon.png');

  // 4. favicon.png (32x32)
  await sharp(SOURCE_IMAGE)
    .resize(32, 32, { fit: 'contain', background: { r: 12, g: 30, b: 22, alpha: 1 } })
    .png()
    .toFile(path.join(PUBLIC_DIR, 'favicon.png'));
  console.log('✅ Generated public/favicon.png');

  // 5. Update public/manifest.json
  const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
  const manifest = {
    name: "GOLDIA SALES",
    short_name: "GoldiaSales",
    description: "Goldia Zargarlik Zavodi — Savdo, Lom & Kassa Boshqaruvi",
    start_url: "/sales/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0c1e16",
    theme_color: "#0c1e16",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable"
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable"
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any"
      }
    ]
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('✅ Updated public/manifest.json with GOLDIA SALES metadata');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
