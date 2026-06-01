package main

import (
	"encoding/json"

	appstatic "github.com/zhiyingzzhou/renewlet/packages/server/internal/static"
)

type mediaResolverConfig struct {
	BuiltInProviders []struct {
		Provider          string   `json:"provider"`
		CDNBase           string   `json:"cdnBase"`
		PreferredVariants []string `json:"preferredVariants"`
	} `json:"builtInProviders"`
	Auto struct {
		PlanSuffixWords []string `json:"planSuffixWords"`
	} `json:"auto"`
	Search struct {
		MinReducedQueryLength int      `json:"minReducedQueryLength"`
		ModifierSuffixWords   []string `json:"modifierSuffixWords"`
	} `json:"search"`
	CandidateGroups struct {
		SearchFaviconReserve int `json:"searchFaviconReserve"`
	} `json:"candidateGroups"`
	Limits struct {
		DefaultCandidates   int `json:"defaultCandidates"`
		MaxCandidates       int `json:"maxCandidates"`
		MaxItems            int `json:"maxItems"`
		MaxCandidateDomains int `json:"maxCandidateDomains"`
	} `json:"limits"`
	RateLimit struct {
		DefaultMaxRequests int `json:"defaultMaxRequests"`
		DefaultWindowMs    int `json:"defaultWindowMs"`
	} `json:"rateLimit"`
	Scores struct {
		Exact           float64 `json:"exact"`
		Prefix          float64 `json:"prefix"`
		Contains        float64 `json:"contains"`
		AllParts        float64 `json:"allParts"`
		Subsequence     float64 `json:"subsequence"`
		SlugExactBoost  float64 `json:"slugExactBoost"`
		SlugPrefixBoost float64 `json:"slugPrefixBoost"`
		StrongThreshold float64 `json:"strongThreshold"`
		MediumThreshold float64 `json:"mediumThreshold"`
	} `json:"scores"`
	Favicon struct {
		FallbackTLDs map[string][]string `json:"fallbackTlds"`
		Providers    []struct {
			Provider    string `json:"provider"`
			URLTemplate string `json:"urlTemplate"`
		} `json:"providers"`
		KnownDomains map[string]string `json:"knownDomains"`
	} `json:"favicon"`
}

var mediaResolverCfg = loadMediaResolverConfig()

func loadMediaResolverConfig() mediaResolverConfig {
	var config mediaResolverConfig
	if err := json.Unmarshal(appstatic.MediaResolverConfig, &config); err != nil {
		panic("invalid embedded media resolver config: " + err.Error())
	}
	if len(config.BuiltInProviders) == 0 || config.Search.MinReducedQueryLength <= 0 || len(config.Search.ModifierSuffixWords) == 0 || config.CandidateGroups.SearchFaviconReserve <= 0 || config.CandidateGroups.SearchFaviconReserve >= config.Limits.MaxCandidates || config.Limits.DefaultCandidates <= 0 || config.Limits.MaxCandidates <= 0 || len(config.Favicon.Providers) == 0 {
		panic("invalid embedded media resolver config")
	}
	return config
}

func mediaResolverBuiltInProviderRank() map[string]int {
	out := map[string]int{}
	for index, provider := range mediaResolverCfg.BuiltInProviders {
		if provider.Provider != "" {
			out[provider.Provider] = index
		}
	}
	return out
}

func mediaResolverBuiltInProviderBase(provider string) string {
	for _, item := range mediaResolverCfg.BuiltInProviders {
		if item.Provider == provider {
			return item.CDNBase
		}
	}
	return ""
}

func mediaResolverPreferredVariants(provider string) []string {
	for _, item := range mediaResolverCfg.BuiltInProviders {
		if item.Provider == provider {
			return item.PreferredVariants
		}
	}
	return nil
}

func mediaSearchModifierSuffixWordSet() map[string]struct{} {
	out := map[string]struct{}{}
	for _, word := range mediaResolverCfg.Search.ModifierSuffixWords {
		if word != "" {
			out[word] = struct{}{}
		}
	}
	return out
}

func mediaPlanSuffixWordSet() map[string]struct{} {
	out := map[string]struct{}{}
	for _, word := range mediaResolverCfg.Auto.PlanSuffixWords {
		if word != "" {
			out[word] = struct{}{}
		}
	}
	return out
}
