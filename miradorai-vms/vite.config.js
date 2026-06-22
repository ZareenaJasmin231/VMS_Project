import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://192.168.126.200:80',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: 'ws://192.168.126.200:80',
        ws: true,
        changeOrigin: true,
      }
    }
  }
});