#!/usr/bin/env node
/**
 * Cloudflare CI Wrangler 配置生成器。
 *
 * 架构位置：GitHub Actions 只从 Secrets 注入用户自己的 Worker/D1/R2 资源标识，
 * 仓库模板 `wrangler.jsonc` 保持本地开发占位值，避免真实 Cloudflare ID 被提交。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = join(repoRoot, "wrangler.jsonc");
const outputPath = resolve(repoRoot, process.env.CI_WRANGLER_CONFIG || "wrangler.generated.jsonc");

const requiredEnv = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "WORKER_NAME",
  "D1_DATABASE_ID",
  "R2_BUCKET_NAME",
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function stripJsoncComments(input) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function findBinding(config, key, binding) {
  const bindings = config[key];
  if (!Array.isArray(bindings)) throw new Error(`wrangler.jsonc must contain ${key}`);
  const match = bindings.find((item) => item && typeof item === "object" && item.binding === binding);
  if (!match) throw new Error(`wrangler.jsonc must contain ${binding} in ${key}`);
  return match;
}

for (const name of requiredEnv) requireEnv(name);

const config = JSON.parse(stripJsoncComments(readFileSync(templatePath, "utf8")));
config.name = requireEnv("WORKER_NAME");

const d1 = findBinding(config, "d1_databases", "DB");
d1.database_id = requireEnv("D1_DATABASE_ID");

const r2 = findBinding(config, "r2_buckets", "ASSETS_BUCKET");
r2.bucket_name = requireEnv("R2_BUCKET_NAME");

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Generated Cloudflare Wrangler config: ${outputPath}`);
