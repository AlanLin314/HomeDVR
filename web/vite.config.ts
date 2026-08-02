import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/go2rtc": {
        target: "http://127.0.0.1:1984",
        rewrite: (p) => p.replace(/^\/go2rtc/, ""),
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
