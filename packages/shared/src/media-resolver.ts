import type {
  MediaCandidate,
  MediaCandidateConfidence,
  MediaCandidateGroup,
  MediaCandidateKind,
  MediaCandidateMode,
  MediaCandidateResolveItem,
  MediaCandidateResolveItemResponse,
} from "./schemas/media";
import {
  DEFAULT_BUILT_IN_ICON_SOURCES,
  type BuiltInIconProvider,
  type BuiltInIconSourceSettings,
} from "./built-in-icons";
import { mediaResolverConfig, type MediaResolverConfig } from "./media-resolver-config";

export interface BuiltInIcon {
  provider: BuiltInIconProvider;
  slug: string;
  title: string;
  aliases?: string[];
  categories?: string[];
  variants: BuiltInIconVariant[];
  terms?: string[];
  compactTerms?: string[];
  exactKeys?: string[];
  tokenKeys?: string[];
  hex?: string;
  license?: string;
  url?: string;
  guidelines?: string;
}

export interface BuiltInIconVariant {
  name: string;
  path: string;
}

interface ResolverIcon {
  icon: BuiltInIcon;
  providerRank: number;
  terms: string[];
  compactTerms: string[];
  canonicalKeys: string[];
  tokenKeys: string[];
}

interface BuiltInSearchResult {
  candidates: MediaCandidate[];
  matchedQuery: string | null;
}

interface ExactBuiltInMatch {
  index: number;
  baseConfidence: "exact" | "strong";
}

interface SearchOptions {
  sources: BuiltInIconSourceSettings;
}

export interface MediaResolver {
  config: MediaResolverConfig;
  icons: ResolverIcon[];
  canonicalExact: Map<string, number[]>;
  tokenExact: Map<string, number[]>;
  providerCdnBase: ReadonlyMap<BuiltInIconProvider, string>;
  preferredVariants: ReadonlyMap<BuiltInIconProvider, readonly string[]>;
  planSuffixWords: ReadonlySet<string>;
  searchModifierSuffixWords: ReadonlySet<string>;
}

export function createMediaResolver(
  icons: readonly BuiltInIcon[],
  config: MediaResolverConfig = mediaResolverConfig,
): MediaResolver {
  const providerRank = new Map(config.builtInProviders.map((provider, index) => [provider.provider, index]));
  const resolver: MediaResolver = {
    config,
    icons: [],
    canonicalExact: new Map(),
    tokenExact: new Map(),
    providerCdnBase: new Map(config.builtInProviders.map((provider) => [provider.provider, provider.cdnBase])),
    preferredVariants: new Map(config.builtInProviders.map((provider) => [provider.provider, provider.preferredVariants])),
    planSuffixWords: new Set(config.auto.planSuffixWords),
    searchModifierSuffixWords: new Set(config.search.modifierSuffixWords),
  };

  for (const icon of icons) {
    if (!icon.variants.length) continue;
    const rank = providerRank.get(icon.provider);
    if (rank === undefined) continue;
    const entry: ResolverIcon = {
      icon,
      providerRank: rank,
      terms: normalizedTerms(icon.terms?.length ? icon.terms : [icon.slug, icon.title, icon.url ?? "", icon.guidelines ?? "", ...(icon.aliases ?? []), ...(icon.categories ?? [])]),
      compactTerms: compactTerms(icon.compactTerms?.length ? icon.compactTerms : [icon.slug, icon.title, ...(icon.aliases ?? [])]),
      canonicalKeys: normalizedTerms(icon.exactKeys?.length ? icon.exactKeys : [icon.slug, icon.title, ...(icon.aliases ?? [])]),
      tokenKeys: normalizedTerms(icon.tokenKeys?.length ? icon.tokenKeys : tokenKeys([icon.slug, icon.title, ...(icon.aliases ?? [])], resolver.planSuffixWords)),
    };
    const index = resolver.icons.length;
    resolver.icons.push(entry);
    for (const key of unique([...entry.canonicalKeys, ...entry.compactTerms])) {
      appendMapValue(resolver.canonicalExact, key, index);
    }
    for (const key of entry.tokenKeys) {
      appendMapValue(resolver.tokenExact, key, index);
    }
  }

  return resolver;
}

export function resolveMediaCandidateItem(
  resolver: MediaResolver,
  kind: MediaCandidateKind,
  mode: MediaCandidateMode,
  item: MediaCandidateResolveItem,
  limit: number,
  options: Partial<SearchOptions> = {},
): MediaCandidateResolveItemResponse {
  const searchOptions: SearchOptions = {
    sources: options.sources ?? DEFAULT_BUILT_IN_ICON_SOURCES,
  };
  const candidates: MediaCandidateGroup = { best: null, builtIn: [], favicon: [] };
  let autoCandidate: MediaCandidate | null = null;

  if (mode === "auto") {
    const candidate = resolveBuiltInAutoCandidate(resolver, kind, item.name, searchOptions);
    if (candidate?.autoAssignable) {
      candidates.builtIn = [candidate];
      candidates.best = candidate;
      autoCandidate = candidate;
    }
    return { id: item.id, autoCandidate, candidates };
  }

  // 搜索模式为 favicon 预留预算，避免多 provider/variants 把弱备用候选挤出；自动分配仍只返回内置高置信候选。
  const builtInLimit = searchBuiltInCandidateLimit(resolver, limit);
  const builtInSearch = searchBuiltInCandidates(resolver, kind, item.name, builtInLimit, searchOptions);
  candidates.builtIn = builtInSearch.candidates;
  const remaining = limit - candidates.builtIn.length;
  if (remaining > 0) {
    // 内置 provider 的降词命中词是 resolver 对“品牌名”的最佳判断；favicon 备用沿用它，避免长套餐名生成噪声域名。
    candidates.favicon = generateFaviconCandidates(resolver, kind, builtInSearch.matchedQuery ?? item.name, item.website ?? "", remaining);
  }
  candidates.best = bestMediaCandidate(candidates);
  return { id: item.id, autoCandidate, candidates };
}

export function clampMediaCandidateLimit(config: MediaResolverConfig, value: number | undefined): number {
  return clamp(value ?? config.limits.defaultCandidates, 1, config.limits.maxCandidates);
}

export function bestMediaCandidate(group: MediaCandidateGroup): MediaCandidate | null {
  return group.builtIn[0] ?? group.favicon[0] ?? null;
}

function searchBuiltInCandidateLimit(resolver: MediaResolver, limit: number): number {
  const reserve = Math.min(resolver.config.candidateGroups.searchFaviconReserve, Math.max(0, limit - 1));
  return Math.max(1, limit - reserve);
}

export function resolveBuiltInAutoCandidate(
  resolver: MediaResolver,
  kind: MediaCandidateKind,
  name: string,
  options: Partial<SearchOptions> = {},
): MediaCandidate | null {
  const searchOptions: SearchOptions = {
    sources: options.sources ?? DEFAULT_BUILT_IN_ICON_SOURCES,
  };
  const queries = reducedMediaQueries(resolver, name);
  for (let index = 0; index < queries.length; index += 1) {
    const candidates = exactBuiltInCandidate(resolver, kind, queries[index] ?? "", index, "auto", searchOptions);
    if (candidates?.[0]) return candidates[0];
  }
  return null;
}

function searchBuiltInCandidates(
  resolver: MediaResolver,
  kind: MediaCandidateKind,
  query: string,
  limit: number,
  options: SearchOptions,
): BuiltInSearchResult {
  const queries = reducedMediaQueries(resolver, query);
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const normalized = queries[queryIndex] ?? "";
    const preferred = exactBuiltInCandidate(resolver, kind, normalized, queryIndex, "search", options);
    // 用户主动搜索允许降词后继续 fuzzy，但过短尾词会把 No/AI 之类泛词搜成噪声候选。
    if (queryIndex > 0 && compactMediaTerm(normalized).length < resolver.config.search.minReducedQueryLength) break;
    const candidates = searchBuiltInCandidatesForQuery(resolver, kind, normalized, limit, preferred, options);
    if (candidates.length > 0) return { candidates, matchedQuery: normalized };
  }
  return { candidates: [], matchedQuery: null };
}

function searchBuiltInCandidatesForQuery(
  resolver: MediaResolver,
  kind: MediaCandidateKind,
  normalized: string,
  limit: number,
  preferred: MediaCandidate[] | null,
  options: SearchOptions,
): MediaCandidate[] {
  if (!normalized || limit <= 0) return [];
  const candidates: MediaCandidate[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate: MediaCandidate) => {
    if (seen.has(candidate.id) || candidates.length >= limit) return;
    seen.add(candidate.id);
    candidates.push({ ...candidate, rank: candidates.length });
  };

  for (const candidate of preferred ?? []) pushCandidate(candidate);
  for (const item of resolver.icons
    .map((entry, index) => ({ entry, index, score: scoreBuiltInIcon(resolver, entry, normalized) }))
    .filter((item) => item.score >= resolver.config.scores.mediumThreshold && providerEnabled(options.sources, item.entry.icon.provider))
    .sort((left, right) => left.entry.providerRank - right.entry.providerRank || right.score - left.score || compareMediaTitle(left.entry.icon.title, right.entry.icon.title))
  ) {
    const confidence = confidenceFromScore(resolver, item.score);
    for (const candidate of toBuiltInCandidates(resolver, item.entry, kind, confidence, confidence === "exact" || confidence === "strong", normalized, candidates.length, "search", options)) {
      pushCandidate(candidate);
      if (candidates.length >= limit) break;
    }
    if (candidates.length >= limit) break;
  }
  return candidates;
}

export function generateFaviconCandidates(
  resolver: MediaResolver,
  kind: MediaCandidateKind,
  name: string,
  website: string,
  limit: number,
): MediaCandidate[] {
  if (limit <= 0) return [];
  const tlds = resolver.config.favicon.fallbackTlds[kind];
  const domains = candidateDomains(resolver, name, website, tlds).slice(0, resolver.config.limits.maxCandidateDomains);
  const candidates = domains.flatMap((domain, domainIndex) => faviconCandidatesForDomain(resolver, kind, domain, domainIndex * resolver.config.favicon.providers.length));
  return candidates.slice(0, limit);
}

export function normalizeMediaTerm(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function compactMediaTerm(value: string): string {
  return normalizeMediaTerm(value).replace(/\s+/g, "");
}

export function reducedMediaQueries(resolver: MediaResolver, name: string): string[] {
  const tokens = normalizeMediaTerm(name).split(/\s+/).filter(Boolean);
  const queries: string[] = [];
  const seen = new Set<string>();
  for (let length = tokens.length; length > 0; length -= 1) {
    const query = tokens.slice(0, length).join(" ");
    if (!query || isPlanOnlyQuery(resolver, query) || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
  }
  return queries;
}

function exactBuiltInCandidate(
  resolver: MediaResolver,
  kind: MediaCandidateKind,
  query: string,
  queryIndex: number,
  mode: "auto" | "search",
  options: SearchOptions,
): MediaCandidate[] | null {
  const normalized = normalizeMediaTerm(query);
  if (!normalized || isPlanOnlyQuery(resolver, normalized)) return null;
  const keys = unique([normalized, compactMediaTerm(normalized)]);
  const matches: ExactBuiltInMatch[] = [];
  for (const key of keys) {
    matches.push(...(resolver.canonicalExact.get(key) ?? []).map((index) => ({ index, baseConfidence: "exact" as const })));
  }
  for (const key of keys) {
    matches.push(...(resolver.tokenExact.get(key) ?? []).map((index) => ({ index, baseConfidence: "strong" as const })));
  }
  return candidateForExactMatches(resolver, kind, matches, normalized, queryIndex, mode, options);
}

function candidateForExactMatches(
  resolver: MediaResolver,
  kind: MediaCandidateKind,
  matches: ExactBuiltInMatch[],
  matchedQuery: string,
  queryIndex: number,
  mode: "auto" | "search",
  options: SearchOptions,
): MediaCandidate[] | null {
  const strongestByIndex = new Map<number, ExactBuiltInMatch["baseConfidence"]>();
  for (const match of matches) {
    const current = strongestByIndex.get(match.index);
    if (!current || match.baseConfidence === "exact") {
      strongestByIndex.set(match.index, match.baseConfidence);
    }
  }
  const enabled = [...strongestByIndex]
    .flatMap(([index, baseConfidence]) => {
      const entry = resolver.icons[index];
      return entry && providerEnabled(options.sources, entry.icon.provider) ? [{ entry, baseConfidence }] : [];
    })
    .sort((left, right) => left.entry.providerRank - right.entry.providerRank || confidenceRank(left.baseConfidence) - confidenceRank(right.baseConfidence) || compareMediaTitle(left.entry.icon.title, right.entry.icon.title));
  if (enabled.length === 0) return null;
  const match = enabled[0];
  if (!match) return null;
  const confidence = queryIndex > 0 || match.baseConfidence === "strong" ? "strong" : "exact";
  return toBuiltInCandidates(resolver, match.entry, kind, confidence, true, matchedQuery, 0, mode, options);
}

function toBuiltInCandidates(
  resolver: MediaResolver,
  entry: ResolverIcon,
  kind: MediaCandidateKind,
  confidence: MediaCandidateConfidence,
  autoAssignable: boolean,
  matchedQuery: string,
  rank: number,
  mode: "auto" | "search",
  options: SearchOptions,
): MediaCandidate[] {
  const provider = entry.icon.provider;
  const variants = mode === "auto" || !options.sources[provider].variantsEnabled
    ? preferredBuiltInVariants(resolver, entry.icon).slice(0, 1)
    : preferredBuiltInVariants(resolver, entry.icon);
  // 自动分配必须保持稳定首选图标；手动搜索才按设置展开上游变体供用户挑选。
  return variants.map((variant): MediaCandidate => ({
    id: `builtin:${provider}:${entry.icon.slug}:${variant.name}`,
    kind,
    source: "builtIn",
    provider,
    label: entry.icon.title,
    variant: variant.name,
    url: builtInVariantURL(resolver, provider, variant),
    confidence,
    autoAssignable,
    matchedQuery,
    rank,
  }));
}

function preferredBuiltInVariants(resolver: MediaResolver, icon: BuiltInIcon): BuiltInIconVariant[] {
  const preferredNames = resolver.preferredVariants.get(icon.provider) ?? [];
  const byName = new Map(icon.variants.map((variant) => [variant.name, variant]));
  const preferred = preferredNames.flatMap((name) => {
    const variant = byName.get(name);
    return variant ? [variant] : [];
  });
  const rest = icon.variants.filter((variant) => !preferredNames.includes(variant.name));
  return [...preferred, ...rest];
}

function builtInVariantURL(resolver: MediaResolver, provider: BuiltInIconProvider, variant: BuiltInIconVariant): string {
  const base = resolver.providerCdnBase.get(provider);
  return `${base}${variant.path}`;
}

function providerEnabled(settings: BuiltInIconSourceSettings, provider: BuiltInIconProvider): boolean {
  return settings[provider].enabled;
}

function faviconCandidatesForDomain(
  resolver: MediaResolver,
  kind: MediaCandidateKind,
  domain: string,
  rankOffset: number,
): MediaCandidate[] {
  return resolver.config.favicon.providers.map((item, index): MediaCandidate => {
    const rank = rankOffset + index;
    return {
      id: `favicon:${item.provider}:${domain}:${rank}`,
      kind,
      source: "favicon",
      provider: item.provider,
      label: domain,
      variant: null,
      url: item.urlTemplate.replace(/\{domain\}/g, domain),
      confidence: "weak",
      autoAssignable: false,
      matchedQuery: domain,
      rank,
    };
  });
}

function candidateDomains(resolver: MediaResolver, query: string, website: string, tlds: readonly string[]): string[] {
  const domains: string[] = [];
  const websiteDomain = extractDomain(website);
  if (websiteDomain) domains.push(websiteDomain);
  const explicit = extractDomain(query);
  if (explicit) domains.push(explicit);
  const queries = faviconMediaQueries(resolver, query);
  for (const reduced of queries) {
    const keyword = compactMediaTerm(reduced);
    if (!usableReducedKeyword(resolver, keyword)) continue;
    const known = resolver.config.favicon.knownDomains[keyword];
    if (known) domains.push(known);
  }
  for (const reduced of queries) {
    const keyword = compactMediaTerm(reduced);
    if (!usableReducedKeyword(resolver, keyword)) continue;
    for (const tld of tlds) domains.push(`${keyword}.${tld}`);
  }
  return unique(domains.flatMap((domain) => {
    const normalized = domain.toLowerCase().trim();
    const parts = normalized.split(".");
    return parts.length === 2 && !normalized.startsWith("www.") ? [normalized, `www.${normalized}`] : [normalized];
  }));
}

function extractDomain(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return null;
    }
  }
  const host = trimmed.split("/")[0]?.toLowerCase() ?? "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

function scoreBuiltInIcon(resolver: MediaResolver, entry: ResolverIcon, query: string): number {
  const compactQuery = compactMediaTerm(query);
  const parts = query.split(/\s+/).filter(Boolean);
  const scores = resolver.config.scores;
  let best = 0;
  for (const value of entry.terms) {
    const compactValue = compactMediaTerm(value);
    if (value === query || compactValue === compactQuery) best = Math.max(best, scores.exact);
    else if (value.startsWith(query) || compactValue.startsWith(compactQuery)) best = Math.max(best, scores.prefix);
    else if (value.includes(query) || compactValue.includes(compactQuery)) best = Math.max(best, scores.contains);
    else if (parts.length > 1 && parts.every((part) => value.includes(part))) best = Math.max(best, scores.allParts);
    else if (compactQuery.length >= 4 && isSubsequence(compactQuery, compactValue)) best = Math.max(best, scores.subsequence);
  }
  for (const value of entry.compactTerms) {
    if (value === compactQuery) best = Math.max(best, scores.exact);
    else if (value.startsWith(compactQuery)) best = Math.max(best, scores.prefix);
    else if (value.includes(compactQuery)) best = Math.max(best, scores.contains);
  }
  if (best === 0) return 0;
  if (normalizeMediaTerm(entry.icon.slug) === query || normalizeMediaTerm(entry.icon.title) === query) return best + scores.slugExactBoost;
  if (normalizeMediaTerm(entry.icon.slug).startsWith(query)) return best + scores.slugPrefixBoost;
  return best;
}

function confidenceFromScore(resolver: MediaResolver, score: number): MediaCandidateConfidence {
  if (score >= resolver.config.scores.exact) return "exact";
  if (score >= resolver.config.scores.strongThreshold) return "strong";
  if (score >= resolver.config.scores.mediumThreshold) return "medium";
  return "weak";
}

function normalizedTerms(values: readonly string[]): string[] {
  return unique(values.map(normalizeMediaTerm).filter(Boolean));
}

function compactTerms(values: readonly string[]): string[] {
  return unique(values.map(compactMediaTerm).filter(Boolean));
}

function tokenKeys(values: readonly string[], planSuffixWords: ReadonlySet<string>): string[] {
  return unique(normalizedTerms(values).flatMap((value) => value.split(/\s+/)).filter((token) => token.length >= 3 && !planSuffixWords.has(token)));
}

function isPlanOnlyQuery(resolver: MediaResolver, query: string): boolean {
  const tokens = normalizeMediaTerm(query).split(/\s+/).filter(Boolean);
  return tokens.length === 0 || tokens.every((token) => resolver.planSuffixWords.has(token));
}

function faviconMediaQueries(resolver: MediaResolver, query: string): string[] {
  const queries = reducedMediaQueries(resolver, query);
  const tokens = normalizeMediaTerm(query).split(/\s+/).filter(Boolean);
  if (tokens.length <= 1 || !resolver.searchModifierSuffixWords.has(tokens[tokens.length - 1] ?? "")) return queries;

  let brandLength = tokens.length;
  while (brandLength > 1 && resolver.searchModifierSuffixWords.has(tokens[brandLength - 1] ?? "")) {
    brandLength -= 1;
  }
  return unique([
    tokens.slice(0, brandLength).join(" "),
    ...queries,
  ]);
}

function usableReducedKeyword(resolver: MediaResolver, keyword: string): boolean {
  return keyword.length >= resolver.config.search.minReducedQueryLength;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function compareMediaTitle(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function confidenceRank(confidence: ExactBuiltInMatch["baseConfidence"]): number {
  return confidence === "exact" ? 0 : 1;
}

function appendMapValue(map: Map<string, number[]>, key: string, value: number) {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
