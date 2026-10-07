/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // CAPELLA lacivert — 600 logonun kendi rengi (#2b4685).
        brand: {
          50: "#f0f4fa", 100: "#dde5f2", 200: "#c0cfe7", 300: "#96afd6",
          400: "#6688c0", 500: "#4469aa", 600: "#2b4685", 700: "#233a6f",
          800: "#1d305b", 900: "#18284b",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
        cardHover: "0 8px 24px rgba(15,23,42,0.06), 0 2px 6px rgba(15,23,42,0.04)",
      },
    },
  },
  plugins: [],
};
