import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JewelryFlow ERP',
    short_name: 'JewelryFlow',
    description: 'Zargarlik biznesini boshqarish tizimi',
    start_url: '/',
    display: 'standalone', // Ilovani to'liq ekranda ochish buyrug'i
    background_color: '#f9fafb',
    theme_color: '#171923',
    icons: [
      {
        src: '/icon.png', // Boya public papkaga tashlagan rasmimiz
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}