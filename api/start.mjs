#!/usr/bin/env node
// ESM wrapper that loads TypeScript with tsx

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Try tsx first (devDependency), fall back to node with --loader
const tsxPath = join(rootDir, "node_modules", ".bin", "tsx");

const child = spawn("node", [
  "--import", "tsx",
  join(__dirname, "index.ts")
], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
