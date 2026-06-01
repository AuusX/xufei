#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "packages/shared/data/media-resolver-config.json");
const serverPath = path.join(repoRoot, "packages/server/internal/static/data/media-resolver-config.json");
const checkOnly = process.argv.includes("--check");

const source = await readFile(sourcePath, "utf8");
const current = await readFile(serverPath, "utf8").catch(() => "");

if (source === current) {
  console.log("media resolver config is in sync");
  process.exit(0);
}

if (checkOnly) {
  throw new Error("packages/server/internal/static/data/media-resolver-config.json is out of sync with packages/shared/data/media-resolver-config.json");
}

await mkdir(path.dirname(serverPath), { recursive: true });
await writeFile(serverPath, source, "utf8");
console.log("synced media resolver config to server embedded data");
