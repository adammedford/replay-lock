import { defineConfig } from "vitest/config";
import { replaylock } from "replaylock/vite";

export default defineConfig({
  plugins: [replaylock()],
  test: {
    include: ["test/dogfood/**/*.test.ts"],
  },
});
