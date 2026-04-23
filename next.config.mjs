/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // TS ve ESLint hataları artık prod build'i durdurur — RBAC/prop tipi
  // hatası sessizce deploy edilmesin. Geliştirme sırasında CI testlerden
  // önce lokal `npm run build` gerektirir.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  // Server action body limiti 20MB — SCORM upload zaten kendi route'unda
  // 200MB kabul ediyor; global 500MB auth'lı kullanıcıya açık DoS yüzeyiydi.
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  serverExternalPackages: ["unzipper"],
  // Vercel serverless fonksiyonlarına TTF font dosyalarını ve Logo.png'yi
  // bundle et — @react-pdf/renderer runtime'da process.cwd()/public/fonts
  // altından okuyor; aksi hâlde Türkçe karakterler (ş, ğ, İ vb.) bozuk çıkıyor.
  // Tüm PDF route'larını kapsayacak şekilde genişletildi.
  outputFileTracingIncludes: {
    "/api/certificate/**": ["./public/fonts/**", "./public/Logo.png"],
    "/api/manager/team/pdf": ["./public/fonts/**", "./public/Logo.png"],
    "/api/**": ["./public/fonts/**", "./public/Logo.png"],
  },
  images: {
    // SVG'ye user-generated yükleme yok ve etkin kullanım yok; XSS yüzeyini
    // kapatmak için dangerouslyAllowSVG kapalı.
    dangerouslyAllowSVG: false,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // unzipper optionally requires @aws-sdk/client-s3 which we don't use
      config.externals = config.externals || [];
      config.externals.push({ "@aws-sdk/client-s3": "commonjs @aws-sdk/client-s3" });
    }
    return config;
  },
};
export default nextConfig;
