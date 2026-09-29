import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // SCORM paketi LMS API'sini window.parent üzerinde arar; bu yüzden iframe
      // aynı origin'den servis edilmek zorunda. Canlıda firebase.json'daki
      // hosting rewrite bunu yapıyor, geliştirmede de burada vekilliyoruz.
      "/scorm-content": {
        target: "https://europe-west3-bonair-academy.cloudfunctions.net",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/scorm-content/, "/serveScormContent"),
      },
    },
  },
});
