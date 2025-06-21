import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    tailwindcss(),
    viteReact(),
  ],
  // test: {
  //   globals: true,
  //   environment: "jsdom",
  // },
  resolve: {
    alias: {
      "@features": resolve(__dirname, "./src/features"),
      "@": resolve(__dirname, "./src"),
    },
  },
});
