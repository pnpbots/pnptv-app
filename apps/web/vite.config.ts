import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @daimo/sdk optionally imports @solana/web3.js which is not installed.
      // Alias it to a safe empty stub so Rollup doesn't abort the build.
      "@solana/web3.js": path.resolve(__dirname, "./src/stubs/solana-web3.ts"),
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
