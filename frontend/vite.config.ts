import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  envPrefix: ["BACKEND", "FRONTEND","FRONTEND_URL","BACKEND_URL"],
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: "https://localhost:3000",
        changeOrigin: true,
        secure: false,
      },
      "/uploads": {
        target: "https://localhost:3000",
        changeOrigin: true,
        secure: false,
      },
      "/socket.io": {
        target: "https://localhost:3000",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  // esbuild 0.27 falha com o target padrão do Vite (safari14) ao transformar destructuring
  optimizeDeps: {
    esbuildOptions: { target: "es2020" },
  },
  build: {
    target: "es2020",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
