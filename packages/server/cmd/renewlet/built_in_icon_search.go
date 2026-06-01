package main

// built_in_icon_search.go 是 Logo Resolver 的内置图标 provider 搜索层。
//
// 架构位置：索引数据来自 embedded static 包，resolver 只返回统一 media candidate DTO，
// 避免客户端 bundle 持有完整索引和第三方 CDN 拼接规则。
import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	appstatic "github.com/zhiyingzzhou/renewlet/packages/server/internal/static"
)

var mediaTermSeparatorRE = regexp.MustCompile(`[^\pL\pN]+`)

var planSuffixWords = mediaPlanSuffixWordSet()
var searchModifierSuffixWords = mediaSearchModifierSuffixWordSet()

// builtInIcon 是内嵌多 provider 索引的原始条目。
type builtInIcon struct {
	Provider     string               `json:"provider"`
	Slug         string               `json:"slug"`
	Title        string               `json:"title"`
	Aliases      []string             `json:"aliases"`
	Categories   []string             `json:"categories"`
	Variants     []builtInIconVariant `json:"variants"`
	Terms        []string             `json:"terms,omitempty"`
	CompactTerms []string             `json:"compactTerms,omitempty"`
	ExactKeys    []string             `json:"exactKeys,omitempty"`
	TokenKeys    []string             `json:"tokenKeys,omitempty"`
	Hex          string               `json:"hex,omitempty"`
	License      string               `json:"license,omitempty"`
	URL          string               `json:"url,omitempty"`
	Guidelines   string               `json:"guidelines,omitempty"`
}

type builtInIconVariant struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type builtInResolverIcon struct {
	icon          builtInIcon
	providerRank  int
	terms         []string
	compactTerms  []string
	canonicalKeys []string
	tokenKeys     []string
}

type builtInResolverIndex struct {
	icons          []builtInResolverIcon
	canonicalExact map[string][]int
	tokenExact     map[string][]int
}

type builtInScoredIcon struct {
	index int
	score float64
}

type builtInExactMatch struct {
	index          int
	baseConfidence string
}

type builtInSearchResult struct {
	candidates   []mediaCandidate
	matchedQuery string
}

type builtInIconSourceSetting struct {
	Enabled         bool `json:"enabled"`
	VariantsEnabled bool `json:"variantsEnabled"`
}

type builtInIconSourceSettings map[string]builtInIconSourceSetting

type builtInIconSourceSettingPatch struct {
	Enabled         *bool `json:"enabled"`
	VariantsEnabled *bool `json:"variantsEnabled"`
}

var builtInResolver = buildBuiltInResolverIndex(loadBuiltInIconIndex())

func loadBuiltInIconIndex() []builtInIcon {
	var icons []builtInIcon
	if err := json.Unmarshal(appstatic.BuiltInIconsIndex, &icons); err != nil {
		// embedded 索引损坏时降级为空结果，让服务仍可启动，便于通过健康检查发现问题后修复镜像。
		return []builtInIcon{}
	}
	return icons
}

func buildBuiltInResolverIndex(icons []builtInIcon) builtInResolverIndex {
	rankByProvider := mediaResolverBuiltInProviderRank()
	resolver := builtInResolverIndex{
		icons:          make([]builtInResolverIcon, 0, len(icons)),
		canonicalExact: map[string][]int{},
		tokenExact:     map[string][]int{},
	}
	for _, icon := range icons {
		providerRank, ok := rankByProvider[icon.Provider]
		if !ok || len(icon.Variants) == 0 {
			continue
		}
		entry := builtInResolverIcon{
			icon:          icon,
			providerRank:  providerRank,
			terms:         normalizedTerms(builtInIconTermValues(icon)),
			compactTerms:  compactTerms([]string{icon.Slug, icon.Title}),
			canonicalKeys: normalizedTerms(append([]string{icon.Slug, icon.Title}, icon.Aliases...)),
			tokenKeys:     exactTokenKeys(append([]string{icon.Slug, icon.Title}, icon.Aliases...)),
		}
		if len(icon.Terms) > 0 {
			entry.terms = normalizedTerms(icon.Terms)
		}
		if len(icon.CompactTerms) > 0 {
			entry.compactTerms = compactTerms(icon.CompactTerms)
		}
		if len(icon.ExactKeys) > 0 {
			entry.canonicalKeys = normalizedTerms(icon.ExactKeys)
		}
		if len(icon.TokenKeys) > 0 {
			entry.tokenKeys = normalizedTerms(icon.TokenKeys)
		}

		index := len(resolver.icons)
		resolver.icons = append(resolver.icons, entry)
		for _, key := range uniqueStrings(append(entry.canonicalKeys, entry.compactTerms...)) {
			resolver.canonicalExact[key] = append(resolver.canonicalExact[key], index)
		}
		for _, key := range entry.tokenKeys {
			resolver.tokenExact[key] = append(resolver.tokenExact[key], index)
		}
	}
	return resolver
}

func builtInIconTermValues(icon builtInIcon) []string {
	values := []string{icon.Slug, icon.Title, icon.URL, icon.Guidelines}
	values = append(values, icon.Aliases...)
	values = append(values, icon.Categories...)
	return values
}

func defaultBuiltInIconSourceSettings() builtInIconSourceSettings {
	return builtInIconSourceSettings{
		"thesvg":         {Enabled: true, VariantsEnabled: true},
		"selfhst":        {Enabled: true, VariantsEnabled: true},
		"dashboardIcons": {Enabled: true, VariantsEnabled: true},
	}
}

func resolveBuiltInAutoCandidate(kind string, name string, sources builtInIconSourceSettings) *mediaCandidate {
	queries := reducedMediaQueries(name)
	for queryIndex, query := range queries {
		if candidates := builtInResolver.exactCandidates(kind, query, queryIndex, "auto", sources); len(candidates) > 0 {
			return &candidates[0]
		}
	}
	return nil
}

func (resolver builtInResolverIndex) exactCandidates(kind string, query string, queryIndex int, mode string, sources builtInIconSourceSettings) []mediaCandidate {
	normalized := normalizeMediaTerm(query)
	if normalized == "" || isPlanOnlyQuery(normalized) {
		return nil
	}
	compact := compactMediaTerm(normalized)
	keys := uniqueStrings([]string{normalized, compact})
	matches := []builtInExactMatch{}
	for _, key := range keys {
		for _, index := range resolver.canonicalExact[key] {
			matches = append(matches, builtInExactMatch{index: index, baseConfidence: "exact"})
		}
	}
	for _, key := range keys {
		for _, index := range resolver.tokenExact[key] {
			matches = append(matches, builtInExactMatch{index: index, baseConfidence: "strong"})
		}
	}
	return resolver.candidatesForExactMatches(kind, matches, normalized, queryIndex, mode, sources)
}

func (resolver builtInResolverIndex) candidatesForExactMatches(kind string, matches []builtInExactMatch, matchedQuery string, queryIndex int, mode string, sources builtInIconSourceSettings) []mediaCandidate {
	strongestByIndex := map[int]string{}
	for _, match := range matches {
		current, ok := strongestByIndex[match.index]
		if !ok || match.baseConfidence == "exact" || current == "" {
			strongestByIndex[match.index] = match.baseConfidence
		}
	}
	enabled := []struct {
		entry          builtInResolverIcon
		baseConfidence string
	}{}
	for index, baseConfidence := range strongestByIndex {
		if index >= 0 && index < len(resolver.icons) && builtInProviderEnabled(sources, resolver.icons[index].icon.Provider) {
			enabled = append(enabled, struct {
				entry          builtInResolverIcon
				baseConfidence string
			}{entry: resolver.icons[index], baseConfidence: baseConfidence})
		}
	}
	if len(enabled) == 0 {
		return nil
	}
	sort.SliceStable(enabled, func(i, j int) bool {
		if enabled[i].entry.providerRank != enabled[j].entry.providerRank {
			return enabled[i].entry.providerRank < enabled[j].entry.providerRank
		}
		if confidenceRank(enabled[i].baseConfidence) != confidenceRank(enabled[j].baseConfidence) {
			return confidenceRank(enabled[i].baseConfidence) < confidenceRank(enabled[j].baseConfidence)
		}
		return enabled[i].entry.icon.Title < enabled[j].entry.icon.Title
	})
	confidence := enabled[0].baseConfidence
	if queryIndex > 0 || confidence == "strong" {
		confidence = "strong"
	}
	return enabled[0].entry.toCandidates(kind, confidence, true, matchedQuery, 0, mode, sources)
}

func searchBuiltInCandidates(kind string, query string, limit int, sources builtInIconSourceSettings) builtInSearchResult {
	for queryIndex, normalized := range reducedMediaQueries(query) {
		preferred := builtInResolver.exactCandidates(kind, normalized, queryIndex, "search", sources)
		// 用户主动搜索允许降词后继续 fuzzy，但过短尾词会把 No/AI 之类泛词搜成噪声候选。
		if queryIndex > 0 && len([]rune(compactMediaTerm(normalized))) < mediaResolverCfg.Search.MinReducedQueryLength {
			break
		}
		candidates := searchBuiltInCandidatesForQuery(kind, normalized, limit, preferred, sources)
		if len(candidates) > 0 {
			return builtInSearchResult{candidates: candidates, matchedQuery: normalized}
		}
	}
	return builtInSearchResult{candidates: []mediaCandidate{}}
}

func searchBuiltInCandidatesForQuery(kind string, normalized string, limit int, preferred []mediaCandidate, sources builtInIconSourceSettings) []mediaCandidate {
	if normalized == "" || limit <= 0 {
		return []mediaCandidate{}
	}
	candidates := []mediaCandidate{}
	seen := map[string]struct{}{}
	pushCandidate := func(candidate mediaCandidate) {
		if _, ok := seen[candidate.ID]; ok || len(candidates) >= limit {
			return
		}
		seen[candidate.ID] = struct{}{}
		candidate.Rank = len(candidates)
		candidates = append(candidates, candidate)
	}
	for _, candidate := range preferred {
		pushCandidate(candidate)
	}
	scored := make([]builtInScoredIcon, 0, len(builtInResolver.icons))
	for index, entry := range builtInResolver.icons {
		if !builtInProviderEnabled(sources, entry.icon.Provider) {
			continue
		}
		score := scoreBuiltInIcon(entry, normalized)
		if score < mediaResolverCfg.Scores.MediumThreshold {
			continue
		}
		scored = append(scored, builtInScoredIcon{index: index, score: score})
	}
	sort.SliceStable(scored, func(i, j int) bool {
		leftEntry := builtInResolver.icons[scored[i].index]
		rightEntry := builtInResolver.icons[scored[j].index]
		if leftEntry.providerRank != rightEntry.providerRank {
			return leftEntry.providerRank < rightEntry.providerRank
		}
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return leftEntry.icon.Title < rightEntry.icon.Title
	})
	for _, item := range scored {
		confidence := confidenceFromScore(item.score)
		for _, candidate := range builtInResolver.icons[item.index].toCandidates(kind, confidence, confidence == "exact" || confidence == "strong", normalized, len(candidates), "search", sources) {
			pushCandidate(candidate)
			if len(candidates) >= limit {
				break
			}
		}
		if len(candidates) >= limit {
			break
		}
	}
	return candidates
}

func (entry builtInResolverIcon) toCandidates(kind string, confidence string, autoAssignable bool, matchedQuery string, rank int, mode string, sources builtInIconSourceSettings) []mediaCandidate {
	icon := entry.icon
	variants := preferredBuiltInVariants(icon)
	if (mode == "auto" || !sources[icon.Provider].VariantsEnabled) && len(variants) > 1 {
		variants = variants[:1]
	}

	candidates := make([]mediaCandidate, 0, len(variants))
	// 自动分配必须保持稳定首选图标；手动搜索才按设置展开上游变体供用户挑选。
	for _, variant := range variants {
		variantName := variant.Name
		candidates = append(candidates, mediaCandidate{
			ID:             "builtin:" + icon.Provider + ":" + icon.Slug + ":" + variantName,
			Kind:           kind,
			Source:         "builtIn",
			Provider:       icon.Provider,
			Label:          icon.Title,
			Variant:        &variantName,
			URL:            mediaResolverBuiltInProviderBase(icon.Provider) + variant.Path,
			Confidence:     confidence,
			AutoAssignable: autoAssignable,
			MatchedQuery:   matchedQuery,
			Rank:           rank,
		})
	}
	return candidates
}

func preferredBuiltInVariants(icon builtInIcon) []builtInIconVariant {
	preferredNames := mediaResolverPreferredVariants(icon.Provider)
	byName := map[string]builtInIconVariant{}
	for _, variant := range icon.Variants {
		byName[variant.Name] = variant
	}
	out := []builtInIconVariant{}
	used := map[string]struct{}{}
	for _, name := range preferredNames {
		if variant, ok := byName[name]; ok {
			out = append(out, variant)
			used[name] = struct{}{}
		}
	}
	for _, variant := range icon.Variants {
		if _, ok := used[variant.Name]; ok {
			continue
		}
		out = append(out, variant)
	}
	return out
}

func builtInProviderEnabled(sources builtInIconSourceSettings, provider string) bool {
	return sources[provider].Enabled
}

func scoreBuiltInIcon(entry builtInResolverIcon, query string) float64 {
	compactQuery := compactMediaTerm(query)
	parts := mediaQueryTokens(query)
	best := 0.0
	for _, value := range entry.terms {
		if value == query || compactMediaTerm(value) == compactQuery {
			best = maxFloat(best, mediaResolverCfg.Scores.Exact)
		} else if strings.HasPrefix(value, query) || strings.HasPrefix(compactMediaTerm(value), compactQuery) {
			best = maxFloat(best, mediaResolverCfg.Scores.Prefix)
		} else if strings.Contains(value, query) || strings.Contains(compactMediaTerm(value), compactQuery) {
			best = maxFloat(best, mediaResolverCfg.Scores.Contains)
		} else if len(parts) > 1 && allPartsIncluded(value, parts) {
			best = maxFloat(best, mediaResolverCfg.Scores.AllParts)
		} else if len(compactQuery) >= 4 && isSubsequence(compactQuery, compactMediaTerm(value)) {
			best = maxFloat(best, mediaResolverCfg.Scores.Subsequence)
		}
	}
	for _, value := range entry.compactTerms {
		if value == compactQuery {
			best = maxFloat(best, mediaResolverCfg.Scores.Exact)
		} else if strings.HasPrefix(value, compactQuery) {
			best = maxFloat(best, mediaResolverCfg.Scores.Prefix)
		} else if strings.Contains(value, compactQuery) {
			best = maxFloat(best, mediaResolverCfg.Scores.Contains)
		}
	}
	if best == 0 {
		return 0
	}
	if normalizeMediaTerm(entry.icon.Slug) == query || normalizeMediaTerm(entry.icon.Title) == query {
		return best + mediaResolverCfg.Scores.SlugExactBoost
	}
	if strings.HasPrefix(normalizeMediaTerm(entry.icon.Slug), query) {
		return best + mediaResolverCfg.Scores.SlugPrefixBoost
	}
	return best
}

func confidenceFromScore(score float64) string {
	if score >= mediaResolverCfg.Scores.Exact {
		return "exact"
	}
	if score >= mediaResolverCfg.Scores.StrongThreshold {
		return "strong"
	}
	if score >= mediaResolverCfg.Scores.MediumThreshold {
		return "medium"
	}
	return "weak"
}

func confidenceRank(confidence string) int {
	if confidence == "exact" {
		return 0
	}
	return 1
}

func normalizeMediaTerm(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = mediaTermSeparatorRE.ReplaceAllString(normalized, " ")
	return strings.Join(strings.Fields(normalized), " ")
}

func compactMediaTerm(value string) string {
	return strings.ReplaceAll(normalizeMediaTerm(value), " ", "")
}

func mediaQueryTokens(value string) []string {
	return strings.Fields(normalizeMediaTerm(value))
}

func reducedMediaQueries(name string) []string {
	tokens := mediaQueryTokens(name)
	queries := []string{}
	seen := map[string]struct{}{}
	// 自动分配只走“从右向左降词”的高置信链路；套餐词可被删除，但不能单独把 Pro/Plus 判成品牌。
	for length := len(tokens); length > 0; length-- {
		query := strings.Join(tokens[:length], " ")
		if query == "" || isPlanOnlyQuery(query) {
			continue
		}
		if _, ok := seen[query]; ok {
			continue
		}
		seen[query] = struct{}{}
		queries = append(queries, query)
	}
	return queries
}

func isPlanOnlyQuery(query string) bool {
	tokens := mediaQueryTokens(query)
	if len(tokens) == 0 {
		return true
	}
	for _, token := range tokens {
		if _, ok := planSuffixWords[token]; !ok {
			return false
		}
	}
	return true
}

func normalizedTerms(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized := normalizeMediaTerm(value)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	return out
}

func compactTerms(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		compact := compactMediaTerm(value)
		if compact == "" {
			continue
		}
		if _, ok := seen[compact]; ok {
			continue
		}
		seen[compact] = struct{}{}
		out = append(out, compact)
	}
	return out
}

func exactTokenKeys(values []string) []string {
	keys := []string{}
	seen := map[string]struct{}{}
	for _, value := range normalizedTerms(values) {
		for _, token := range strings.Fields(value) {
			if len([]rune(token)) < 3 {
				continue
			}
			if _, skip := planSuffixWords[token]; skip {
				continue
			}
			if _, ok := seen[token]; ok {
				continue
			}
			seen[token] = struct{}{}
			keys = append(keys, token)
		}
	}
	return keys
}

func allPartsIncluded(value string, parts []string) bool {
	for _, part := range parts {
		if !strings.Contains(value, part) {
			return false
		}
	}
	return true
}

func isSubsequence(needle string, haystack string) bool {
	if needle == "" {
		return true
	}
	index := 0
	for _, char := range haystack {
		if index < len(needle) && byte(char) == needle[index] {
			index++
		}
		if index == len(needle) {
			return true
		}
	}
	return false
}

func maxFloat(left float64, right float64) float64 {
	if left > right {
		return left
	}
	return right
}
