import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const devProxyTarget = process.env["VITE_DEV_PROXY_TARGET"] || "http://127.0.0.1:3000";
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "connect-src 'self' https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const vendorChunkGroups = [
  {
    name: "react-vendor",
    test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|@tanstack)[\\/]/,
    priority: 50,
  },
  {
    name: "radix-vendor",
    test: /node_modules[\\/]@radix-ui[\\/]/,
    priority: 40,
  },
  {
    name: "charts-vendor",
    test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|react-smooth|decimal\.js-light)[\\/]/,
    priority: 35,
  },
  {
    name: "forms-vendor",
    test: /node_modules[\\/](react-hook-form|@hookform|zod|react-number-format|input-otp)[\\/]/,
    priority: 30,
  },
  {
    name: "time-vendor",
    test: /node_modules[\\/](@js-temporal|jsbi)[\\/]/,
    priority: 25,
  },
  {
    name: "runtime-ui-vendor",
    test: /node_modules[\\/](lucide-react|framer-motion|vaul|cmdk|sonner|react-day-picker|date-fns|embla-carousel-react|@dnd-kit|class-variance-authority|clsx|tailwind-merge|react-resizable-panels)[\\/]/,
    priority: 20,
  },
  {
    name: "data-vendor",
    test: /node_modules[\\/](pocketbase)[\\/]/,
    priority: 10,
  },
];

export default defineConfig({
  plugins: [lingui({ failOnCompileError: true }), tailwindcss(), react()],
  worker: {
    plugins: () => [lingui({ failOnCompileError: true })],
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  server: {
    port: 5173,
    headers: {
      "Content-Security-Policy": contentSecurityPolicy,
    },
    proxy: {
      "/api": devProxyTarget,
      "/_": devProxyTarget,
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Workers Static Assets 直接下发前端产物；按依赖边界拆主包，避免首屏 JS 重新越过 Vite 500KB 预警线。
        codeSplitting: {
          groups: vendorChunkGroups,
        },
      },
    },
  },
});
