#!/usr/bin/env node

/**
 * 图标索引生成脚本（内置多 provider）。
 *
 * 架构位置：把上游 registry/metadata 收敛成前端搜索和后端 embedded static 共用的窄 JSON，
 * 避免客户端运行时拉取完整上游数据。
 *
 * 注意： 生成结果是仓库内静态数据；上游字段或 CDN 路径变化时必须先保证前后端解析仍兼容。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, "../packages/shared/data/media-resolver-config.json");
const mediaResolverConfig = JSON.parse(await readFile(configPath, "utf8"));
const PROVIDERS = Object.fromEntries(mediaResolverConfig.builtInProviders.map((item) => [item.provider, item]));
const PLAN_SUFFIX_WORDS = new Set(mediaResolverConfig.auto.planSuffixWords);

const outputPaths = [
  path.resolve(__dirname, "../packages/client/src/lib/built-in-icons-index.json"),
  path.resolve(__dirname, "../packages/server/internal/static/data/built-in-icons-index.json"),
];
const FETCH_TIMEOUT_MS = 15_000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function isSafePathPart(value) {
  // slug/variant 会拼进 CDN 路径，只允许单段安全字符，防止上游数据把 `../` 注入生成索引。
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function normalizeTerm(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactTerm(value) {
  return normalizeTerm(value).replace(/\s+/g, "");
}

function uniqueTerms(values) {
  return [...new Set(values.map(normalizeTerm).filter(Boolean))];
}

function exactKeysForIcon(icon) {
  const canonical = uniqueTerms([icon.slug, icon.title, ...icon.aliases]);
  const compact = canonical.map(compactTerm).filter(Boolean);
  return [...new Set([...canonical, ...compact])];
}

function tokenKeysForIcon(icon) {
  const canonical = uniqueTerms([icon.slug, icon.title, ...icon.aliases]);
  return [...new Set(canonical
    .flatMap((term) => term.split(/\s+/))
    .filter((term) => term.length >= 3 && !PLAN_SUFFIX_WORDS.has(term)))];
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${label} HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonAny(urls, label) {
  const errors = [];
  for (const url of urls) {
    try {
      return await fetchJson(url, label);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`${label} failed: ${errors.join("; ")}`);
}

function iconRecord(input) {
  return {
    ...input,
    terms: uniqueTerms([input.slug, input.title, ...input.aliases, ...input.categories]),
    compactTerms: uniqueTerms([input.slug, input.title, ...input.aliases]).map(compactTerm).filter(Boolean),
    exactKeys: exactKeysForIcon(input),
    tokenKeys: tokenKeysForIcon(input),
  };
}

function parseTheSvgVariants(slug, value) {
  if (!isRecord(value)) return [];
  const variants = [];
  for (const [variant, pathValue] of Object.entries(value)) {
    if (!isSafePathPart(variant)) continue;
    if (typeof pathValue !== "string") continue;
    const normalizedPath = pathValue.trim();
    if (!normalizedPath.endsWith(".svg")) continue;
    // 上游 registry 是 CDN 路径事实源，但路径仍必须锁在当前 slug 下，避免跨目录引用污染候选 URL。
    if (!normalizedPath.startsWith(`/icons/${slug}/`)) continue;
    variants.push({ name: variant, path: `/public${normalizedPath}` });
  }
  return variants;
}

async function loadTheSvgIcons() {
  const registry = await fetchJson(`${PROVIDERS.thesvg.cdnBase}/src/data/icons.json`, "theSVG registry");
  if (!Array.isArray(registry)) return [];
  const icons = [];
  const seen = new Set();
  for (const item of registry) {
    if (!isRecord(item)) continue;
    const slug = asString(item.slug);
    const title = asString(item.title);
    if (!slug || !title || !isSafePathPart(slug) || seen.has(slug)) continue;
    const variants = parseTheSvgVariants(slug, item.variants);
    if (variants.length === 0) continue;
    const aliases = asStringArray(item.aliases);
    const categories = asStringArray(item.categories);
    icons.push(iconRecord({
      provider: "thesvg",
      slug,
      title,
      aliases,
      categories,
      variants,
      hex: asString(item.hex),
      license: asString(item.license),
      url: asString(item.url),
      guidelines: asString(item.guidelines),
    }));
    seen.add(slug);
  }
  return icons;
}

function selfhstVariants(reference, item) {
  const variants = [];
  if (item.SVG === "Yes" || item.SVG === "Y") variants.push({ name: "default", path: `/svg/${reference}.svg` });
  if (item.Light === "Yes" || item.Light === "Y") variants.push({ name: "light", path: `/svg/${reference}-light.svg` });
  if (item.Dark === "Yes" || item.Dark === "Y") variants.push({ name: "dark", path: `/svg/${reference}-dark.svg` });
  return variants;
}

async function loadSelfhstIcons() {
  const registry = await fetchJsonAny([
    `${PROVIDERS.selfhst.cdnBase}/index.json`,
    "https://raw.githubusercontent.com/selfhst/icons/main/index.json",
  ], "selfh.st index");
  if (!Array.isArray(registry)) return [];
  const icons = [];
  const seen = new Set();
  for (const item of registry) {
    if (!isRecord(item)) continue;
    const slug = asString(item.Reference);
    const title = asString(item.Name);
    if (!slug || !title || !isSafePathPart(slug) || seen.has(slug)) continue;
    const variants = selfhstVariants(slug, item);
    if (variants.length === 0) continue;
    const tagTerms = asString(item.Tags)?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    const categories = [asString(item.Category), ...tagTerms].filter(Boolean);
    icons.push(iconRecord({
      provider: "selfhst",
      slug,
      title,
      aliases: [],
      categories,
      variants,
    }));
    seen.add(slug);
  }
  return icons;
}

function dashboardVariants(slug, item, svgFiles) {
  const variants = [];
  if (svgFiles.has(`${slug}.svg`)) variants.push({ name: "default", path: `/svg/${slug}.svg` });
  if (isRecord(item.colors)) {
    for (const variantName of ["light", "dark"]) {
      const fileSlug = asString(item.colors[variantName]);
      if (!fileSlug || !isSafePathPart(fileSlug)) continue;
      if (svgFiles.has(`${fileSlug}.svg`)) variants.push({ name: variantName, path: `/svg/${fileSlug}.svg` });
    }
  }
  return variants;
}

async function loadDashboardIcons() {
  const [metadata, tree] = await Promise.all([
    fetchJsonAny([
      `${PROVIDERS.dashboardIcons.cdnBase}/metadata.json`,
      "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/metadata.json",
    ], "Dashboard Icons metadata"),
    fetchJsonAny([
      `${PROVIDERS.dashboardIcons.cdnBase}/tree.json`,
      "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/tree.json",
    ], "Dashboard Icons tree"),
  ]);
  if (!isRecord(metadata) || !isRecord(tree) || !Array.isArray(tree.svg)) return [];
  const svgFiles = new Set(tree.svg.filter((item) => typeof item === "string"));
  const icons = [];
  for (const [slug, item] of Object.entries(metadata)) {
    if (!isSafePathPart(slug) || !isRecord(item)) continue;
    const variants = dashboardVariants(slug, item, svgFiles);
    if (variants.length === 0) continue;
    const aliases = asStringArray(item.aliases);
    const categories = asStringArray(item.categories);
    icons.push(iconRecord({
      provider: "dashboardIcons",
      slug,
      title: titleFromSlug(slug),
      aliases,
      categories,
      variants,
    }));
  }
  return icons;
}

function titleFromSlug(slug) {
  return slug.split("-").filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}

const icons = [
  ...await loadTheSvgIcons(),
  ...await loadSelfhstIcons(),
  ...await loadDashboardIcons(),
];

if (icons.length === 0) {
  throw new Error("built-in icon index generation produced no icons");
}

for (const outputPath of outputPaths) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(icons)}\n`, "utf8");
}

const counts = icons.reduce((acc, icon) => ({ ...acc, [icon.provider]: (acc[icon.provider] ?? 0) + 1 }), {});
console.log(`Generated ${icons.length} built-in icons (${Object.entries(counts).map(([provider, count]) => `${provider}:${count}`).join(", ")}) at ${outputPaths.map((item) => path.relative(process.cwd(), item)).join(", ")}`);
