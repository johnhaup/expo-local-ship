import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  splitting: false,
  shims: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
