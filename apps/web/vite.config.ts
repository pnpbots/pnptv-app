import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

function swBuildIdPlugin() {
  return {
    name: "sw-build-id",
    closeBundle() {
      const sha = execSync("git rev-parse --short HEAD").toString().trim();
      const swPath = path.resolve(__dirname, "dist/sw.js");
      try {
        const content = readFileSync(swPath, "utf-8");
        writeFileSync(swPath, content.replace(/pnptv-__BUILD_ID__/g, `pnptv-${sha}`));
      } catch { /* sw.js not in dist — skip */ }
    },
  };
}

export default defineConfig({
  plugins: [react(), swBuildIdPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          auth: ["oidc-client-ts"],
          media: ["hls.js"],
          livekit: [
            "@livekit/components-react",
            "@livekit/components-core",
            "@livekit/components-styles",
            "livekit-client",
          ],
          socket: ["socket.io-client"],
        },
      },
    },
  },
});
