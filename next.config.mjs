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
  // Güvenlik header'ları — clickjacking, MIME-sniffing, HTTPS downgrade,
  // info leak ve XSS yüzeylerini daraltır. CSP pragmatik tutuldu:
  //  - 'unsafe-inline' script/style: Next.js SSR inline script + Tailwind
  //    için şart (strict CSP için nonce altyapısı gerekir — ayrı iş).
  //  - Google reCAPTCHA v3 için www.google.com + www.gstatic.com izinli.
  //  - SCORM iframe'i Vercel Blob'dan içerik yükleyebilsin diye frame-src
  //    *.public.blob.vercel-storage.com + same-origin.
  //  - frame-ancestors 'self' = modern X-Frame-Options eşdeğeri (clickjacking).
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://www.gstatic.com https://www.google.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://www.google.com https://*.public.blob.vercel-storage.com",
      "frame-src 'self' https://www.google.com https://*.public.blob.vercel-storage.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
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
