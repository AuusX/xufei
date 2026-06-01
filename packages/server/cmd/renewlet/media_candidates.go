package main

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

func mediaCandidates(e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	if e.Auth == nil {
		return e.UnauthorizedError(tr(locale, "请先登录", "Please sign in first"), nil)
	}
	body, err := decodeStrictJSON[mediaCandidateResolveRequest](e.Request, locale)
	if err != nil {
		return e.BadRequestError(validationErrorMessage(locale, "请求体无效", "Invalid request body", err), err)
	}
	if retryAfter := checkMediaCandidateRateLimit(e); retryAfter > 0 {
		setRetryAfter(e, retryAfter)
		return e.JSON(http.StatusTooManyRequests, rateLimitedResponse{
			Code:    "RATE_LIMITED",
			Message: tr(locale, "请求过于频繁，请稍后再试", "Too many requests. Please try again later"),
		})
	}

	limit := mediaResolverCfg.Limits.DefaultCandidates
	if body.Limit != nil {
		limit = *body.Limit
	}
	limit = clampInt(limit, 1, mediaResolverCfg.Limits.MaxCandidates)
	settings, err := currentUserSettings(e.App, e.Auth, nil)
	if err != nil {
		return e.BadRequestError(validationErrorMessage(locale, "设置无效", "Invalid settings", err), err)
	}

	items := make([]mediaCandidateResolveItemResponse, 0, len(body.Items))
	for _, item := range body.Items {
		items = append(items, resolveMediaCandidateItem(body.Kind, body.Mode, item, limit, settings.BuiltInIconSources))
	}
	setPrivateShortCache(e)
	return e.JSON(http.StatusOK, mediaCandidateResolveResponse{Items: items})
}

func resolveMediaCandidateItem(kind string, mode string, item mediaCandidateResolveItem, limit int, sources builtInIconSourceSettings) mediaCandidateResolveItemResponse {
	group := mediaCandidateGroup{
		BuiltIn: []mediaCandidate{},
		Favicon: []mediaCandidate{},
	}
	var autoCandidate *mediaCandidate

	if mode == "auto" {
		// 导入自动分配只接受内置 provider 的高置信命中；favicon/domain 弱候选必须留给用户手动选择。
		if candidate := resolveBuiltInAutoCandidate(kind, item.Name, sources); candidate != nil && candidate.AutoAssignable {
			group.BuiltIn = append(group.BuiltIn, *candidate)
			group.Best = candidate
			autoCandidate = candidate
		}
		return mediaCandidateResolveItemResponse{ID: item.ID, AutoCandidate: autoCandidate, Candidates: group}
	}

	// 搜索模式为 favicon 预留预算，避免多 provider/variants 把弱备用候选挤出；自动分配仍只返回内置高置信候选。
	builtInSearch := searchBuiltInCandidates(kind, item.Name, searchBuiltInCandidateLimit(limit), sources)
	group.BuiltIn = builtInSearch.candidates
	remaining := limit - len(group.BuiltIn)
	if remaining > 0 {
		faviconQuery := item.Name
		if builtInSearch.matchedQuery != "" {
			// 内置 provider 的降词命中词是 resolver 对“品牌名”的最佳判断；favicon 备用沿用它，避免长套餐名生成噪声域名。
			faviconQuery = builtInSearch.matchedQuery
		}
		group.Favicon = generateFaviconCandidates(kind, faviconQuery, item.Website, remaining)
	}
	group.Best = bestMediaCandidate(group)
	return mediaCandidateResolveItemResponse{ID: item.ID, AutoCandidate: nil, Candidates: group}
}

func bestMediaCandidate(group mediaCandidateGroup) *mediaCandidate {
	if len(group.BuiltIn) > 0 {
		return &group.BuiltIn[0]
	}
	if len(group.Favicon) > 0 {
		return &group.Favicon[0]
	}
	return nil
}

func searchBuiltInCandidateLimit(limit int) int {
	reserve := minInt(mediaResolverCfg.CandidateGroups.SearchFaviconReserve, maxInt(0, limit-1))
	return maxInt(1, limit-reserve)
}
