import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileIcons } from "./vite.file-icons.ts";

export default defineConfig({
  root: "ui",
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
      addExtensions: true,
    }),
    react(),
    tailwindcss(),
    fileIcons(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Reachable from other devices on the LAN, like the Go server.
    host: true,
    // Fail when the port is taken instead of moving to the next one, which
    // left forgotten servers behind.
    strictPort: true,
    proxy: {
      "/api": {
        // The Go server's port (-port), set by scripts/run.sh.
        target: `http://localhost:${process.env.API_PORT ?? 8080}`,
        // Keep the Host header: the Go server rejects changes whose Origin
        // differs from the Host (cross-origin protection), and browsers on
        // plain HTTP LAN addresses send no Sec-Fetch-Site to tell otherwise.
        changeOrigin: false,
      },
    },
  },
});
