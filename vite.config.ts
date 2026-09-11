import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { apiDevPlugin } from "./lib/vite-api-plugin";

export default defineConfig({
  tanstackStart: {
    srcDirectory: ".",
  },
  nitro: {
    preset: "node-server",
  },
  plugins: [apiDevPlugin()],
});
