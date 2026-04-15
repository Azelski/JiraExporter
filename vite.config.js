import { resolve } from "path";
import { defineConfig } from "vite";
import { cpSync } from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.js"),
      },
      output: {
        entryFileNames: "[name].js",
        format: "es",
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    {
      name: "copy-static",
      writeBundle() {
        cpSync(resolve(__dirname, "static"), resolve(__dirname, "dist"), {
          recursive: true,
        });
      },
    },
  ],
});
