import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri 期望前端 dev server 固定端口；strictPort 保证端口被占用时直接失败，
// 而不是悄悄换端口导致 Tauri 加载不到页面。
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  // Tauri CLI 自己会输出编译信息，清屏会把它冲掉。
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri 由 cargo 监听，前端不需要重复监听。
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // 目标运行时：Windows 用 WebView2(Chromium)，macOS/Linux 用 WebKit。
    target: "es2021",
    // Vite 8 底层是 rolldown，默认压缩器是 oxc；
    // 显式写 "esbuild" 会要求额外安装 esbuild，这里交给默认值。
    minify: mode === "production",
    sourcemap: mode !== "production",
    chunkSizeWarningLimit: 800,
  },
}));
