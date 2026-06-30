package main

// favicon_search.go 为 Logo Resolver 生成确定性网站/favicon 备用候选。
//
// 架构位置：favicon 只作为用户主动搜索的弱候选，不参与导入自动分配。
// Docker 版不再在请求路径上抓 Google/Brave/外部 HTML，和 Cloudflare 保持同一安全边界。
import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// mediaRateBucket 是按用户/IP 维度的内存限流桶。
type mediaRateBucket struct {
	Count   int
	ResetAt time.Time
}

var (
	mediaRateLimitMu   sync.Mutex
	mediaRateLimitData = map[string]mediaRateBucket{}
)

func generateFaviconCandidates(kind string, name string, website string, limit int) []mediaCandidate {
	if limit <= 0 {
		return []mediaCandidate{}
	}
	fallbackTlds := mediaResolverCfg.Favicon.FallbackTLDs[kind]
	if len(fallbackTlds) == 0 {
		fallbackTlds = mediaResolverCfg.Favicon.FallbackTLDs["icon"]
	}
	domains := buildFaviconCandidateDomains(name, website, fallbackTlds)
	if len(domains) > mediaResolverCfg.Limits.MaxCandidateDomains {
		domains = domains[:mediaResolverCfg.Limits.MaxCandidateDomains]
	}
	candidates := make([]mediaCandidate, 0, minInt(limit, len(domains)*len(mediaResolverCfg.Favicon.Providers)))
	for _, domain := range domains {
		for _, candidate := range faviconCandidatesForDomain(kind, domain, len(candidates)) {
			candidates = append(candidates, candidate)
			if len(candidates) >= limit {
				return candidates
			}
		}
	}
	return candidates
}

func faviconCandidatesForDomain(kind string, domain string, rankOffset int) []mediaCandidate {
	out := make([]mediaCandidate, 0, len(mediaResolverCfg.Favicon.Providers))
	for index, item := range mediaResolverCfg.Favicon.Providers {
		rank := rankOffset + index
		out = append(out, mediaCandidate{
			ID:             fmt.Sprintf("favicon:%s:%s:%d", item.Provider, domain, rank),
			Kind:           kind,
			Source:         "favicon",
			Provider:       item.Provider,
			Label:          domain,
			Variant:        nil,
			URL:            strings.ReplaceAll(item.URLTemplate, "{domain}", domain),
			Confidence:     "weak",
			AutoAssignable: false,
			MatchedQuery:   domain,
			Rank:           rank,
		})
	}
	return out
}

// buildFaviconCandidateDomains 从网站字段和搜索词推导可能的品牌域名。
func buildFaviconCandidateDomains(query string, website string, fallbackTlds []string) []string {
	domains := []string{}
	if domain := extractDomainFromQuery(website); domain != "" {
		domains = append(domains, domain)
	}
	if domain := extractDomainFromQuery(query); domain != "" {
		domains = append(domains, domain)
	}
	queries := faviconMediaQueries(query)
	for _, reduced := range queries {
		keyword := normalizeFaviconKeyword(reduced)
		if !usableFaviconKeyword(keyword) {
			continue
		}
		if known, ok := mediaResolverCfg.Favicon.KnownDomains[keyword]; ok {
			domains = append(domains, known)
		}
	}
	for _, reduced := range queries {
		keyword := normalizeFaviconKeyword(reduced)
		if !usableFaviconKeyword(keyword) {
			continue
		}
		for _, tld := range fallbackTlds {
			if tld = strings.TrimSpace(tld); tld != "" {
				domains = append(domains, keyword+"."+tld)
			}
		}
	}
	return normalizeCandidateDomains(domains)
}

func faviconMediaQueries(query string) []string {
	queries := reducedMediaQueries(query)
	tokens := mediaQueryTokens(query)
	if len(tokens) <= 1 {
		return queries
	}
	if _, ok := searchModifierSuffixWords[tokens[len(tokens)-1]]; !ok {
		return queries
	}
	brandLength := len(tokens)
	for brandLength > 1 {
		if _, ok := searchModifierSuffixWords[tokens[brandLength-1]]; !ok {
			break
		}
		brandLength--
	}
	out := []string{strings.Join(tokens[:brandLength], " ")}
	out = append(out, queries...)
	return uniqueStrings(out)
}

func usableFaviconKeyword(keyword string) bool {
	return len([]rune(keyword)) >= mediaResolverCfg.Search.MinReducedQueryLength
}

func normalizeCandidateDomains(domains []string) []string {
	out := []string{}
	seen := map[string]struct{}{}
	for _, domain := range domains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if domain == "" {
			continue
		}
		if _, ok := seen[domain]; !ok {
			seen[domain] = struct{}{}
			out = append(out, domain)
		}
		parts := strings.Split(domain, ".")
		if len(parts) == 2 && !strings.HasPrefix(domain, "www.") {
			www := "www." + domain
			if _, ok := seen[www]; !ok {
				seen[www] = struct{}{}
				out = append(out, www)
			}
		}
	}
	return out
}

func normalizeFaviconKeyword(input string) string {
	return strings.ToLower(strings.Join(strings.Fields(input), ""))
}

func extractDomainFromQuery(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	if strings.HasPrefix(input, "http://") || strings.HasPrefix(input, "https://") {
		parsed, err := url.Parse(input)
		if err != nil {
			return ""
		}
		return parsed.Hostname()
	}
	host := strings.ToLower(strings.Split(input, "/")[0])
	// 只接受普通域名形态，不解析裸 IP/端口；这里是 favicon 候选生成，不应扩大成通用 URL 解析器。
	if matched, _ := regexp.MatchString(`^[a-z0-9.-]+\.[a-z]{2,}$`, host); matched {
		return host
	}
	return ""
}

func checkMediaCandidateRateLimit(e *core.RequestEvent) int {
	maxRequests := envInt("MEDIA_CANDIDATE_RATE_LIMIT_MAX", envInt("FAVICON_SEARCH_RATE_LIMIT_MAX", mediaResolverCfg.RateLimit.DefaultMaxRequests))
	windowMs := envInt("MEDIA_CANDIDATE_RATE_LIMIT_WINDOW_MS", envInt("FAVICON_SEARCH_RATE_LIMIT_WINDOW_MS", mediaResolverCfg.RateLimit.DefaultWindowMs))
	if maxRequests <= 0 || windowMs <= 0 || e.Auth == nil {
		return 0
	}
	key := e.Auth.Id + ":" + clientIP(e.Request)
	now := time.Now()

	mediaRateLimitMu.Lock()
	defer mediaRateLimitMu.Unlock()

	bucket := mediaRateLimitData[key]
	if bucket.ResetAt.IsZero() || now.After(bucket.ResetAt) {
		mediaRateLimitData[key] = mediaRateBucket{Count: 1, ResetAt: now.Add(time.Duration(windowMs) * time.Millisecond)}
		return 0
	}
	if bucket.Count >= maxRequests {
		return maxInt(1, int(time.Until(bucket.ResetAt).Seconds()))
	}
	bucket.Count++
	mediaRateLimitData[key] = bucket
	return 0
}

// clientIP 从代理头或 RemoteAddr 提取客户端 IP。
func clientIP(req *http.Request) string {
	if forwarded := strings.TrimSpace(req.Header.Get("x-forwarded-for")); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	if realIP := strings.TrimSpace(req.Header.Get("x-real-ip")); realIP != "" {
		return realIP
	}
	host := req.RemoteAddr
	if idx := strings.LastIndex(host, ":"); idx > -1 {
		return host[:idx]
	}
	return host
}

// setPrivateShortCache 设置用户私有短缓存。
// Vary: Authorization 防止共享缓存把某个用户的搜索结果复用给其他会话。
func setPrivateShortCache(e *core.RequestEvent) {
	e.Response.Header().Set("Cache-Control", "private, max-age=300")
	e.Response.Header().Set("Vary", "Authorization")
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func setRetryAfter(e *core.RequestEvent, retryAfter int) {
	e.Response.Header().Set("Retry-After", strconv.Itoa(retryAfter))
}
