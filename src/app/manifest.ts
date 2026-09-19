import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JewelryFlow ERP',
    short_name: 'JewelryFlow',
    description: 'Zargarlik biznesini boshqarish tizimi',
    start_url: '/?mode=pwa', // Keshni tozalash uchun maxsus yo'l
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#171923',
    icons: [
      {
        // To'g'ridan-to'g'ri ishonchli manbadan olingan PNG rasm
        src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Diamond_emoji.png/512px-Diamond_emoji.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Diamond_emoji.png/192px-Diamond_emoji.png',
        sizes: '192x192',
        type: 'image/png',
      }
    ],
  }
}