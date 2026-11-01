import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  splitting: false,
  shims: true,
  // chalk 5 is ESM-only; bundle it so the CJS dist runs on any Node (require(esm) needs Node >= 22.12)
  noExternal: ["chalk"],
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
