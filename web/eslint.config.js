/**
 * Tek amacı var: HOOK KURALLARI.
 *
 * `rules-of-hooks` ihlali (erken `return`den sonra hook çağırmak) derlemeyi
 * bozmuyor, TypeScript de yakalamıyor — ama çalışma anında bütün React ağacını
 * söküyor ve kullanıcıya bembeyaz bir sayfa kalıyor (React #300). Bu tam
 * olarak bir kez oldu: PDF açılamadığında bileşen erken dönüyordu ve altındaki
 * iki hook çalışmıyordu.
 *
 * Bu yüzden kural "error": `npm run lint` kırmızı verirse yayına çıkmaz.
 * Stil kuralları bilerek yok — amaç biçim tartışması değil, bu hata sınıfı.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "public"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Bağımlılık uyarısı bilgi amaçlı: bazı yerlerde bilerek dar tutuluyor.
      "react-hooks/exhaustive-deps": "warn",

      // Aşağıdakiler bu depoda gürültü üretiyor ve amaç dışı; kapalı.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "preserve-caught-error": "off",
    },
  }
);
