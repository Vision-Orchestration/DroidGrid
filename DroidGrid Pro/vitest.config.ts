import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@gridflow-bridge": path.resolve(__dirname, "..", "addons", "gridflow-bridge"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      include: ["src-server/**"],
      reporter: ["text", "lcov"],
    },
  },
});
