import { defineConfig } from "vitest/config";
import yaml from "@rollup/plugin-yaml";

export default defineConfig({
  plugins: [yaml()],
  test: {
    include: ["packages/*/test/**/*.test.ts", "content/test/**/*.test.ts"],
    environment: "node",
  },
});
