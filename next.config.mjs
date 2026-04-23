/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: "500mb" } },
  serverExternalPackages: ["unzipper"],
  // Vercel serverless fonksiyonlarına TTF font dosyalarını ve Logo.png'yi
  // bundle et — @react-pdf/renderer runtime'da process.cwd()/public/fonts
  // altından okuyor; aksi hâlde Türkçe karakterler (ş, ğ, İ vb.) bozuk çıkıyor.
  outputFileTracingIncludes: {
    "/api/certificate/**": ["./public/fonts/**", "./public/Logo.png"],
    "/api/manager/team/pdf": ["./public/fonts/**", "./public/Logo.png"],
  },
  images: {
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
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
