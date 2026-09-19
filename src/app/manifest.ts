import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JewelryFlow ERP',
    short_name: 'JewelryFlow',
    description: 'Zargarlik biznesini boshqarish tizimi',
    start_url: '/',
    display: 'standalone', // MANA SHU QATOR uni brauzer emas, haqiqiy App qilib ochadi!
    background_color: '#f9fafb',
    theme_color: '#171923',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}