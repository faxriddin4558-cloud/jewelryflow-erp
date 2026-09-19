/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Vercel'ga tekshiruvni o'tkazib yuborishni buyurish
    ignoreDuringBuilds: true,
  },
  typescript: {
    // TypeScript xatolariga ko'z yumish
    ignoreBuildErrors: true,
  },
};

export default nextConfig;