import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JewelryFlow ERP',
    short_name: 'JewelryFlow',
    description: 'Zargarlik biznesini boshqarish tizimi',
    start_url: '/',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: '#171923',
    icons: [
      {
        src: '/icon.jpg', // Endi .jpg bo'ldi
        sizes: '192x192',
        type: 'image/jpeg', // Chrome endi xato bermaydi
      },
      {
        src: '/icon.jpg',
        sizes: '512x512',
        type: 'image/jpeg',
      },
      {
        src: '/icon.jpg',
        sizes: 'any',
        type: 'image/jpeg',
      },
    ],
  }
}