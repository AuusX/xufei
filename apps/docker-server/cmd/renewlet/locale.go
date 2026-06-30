package main

// locale.go 统一处理 API 文案的语言协商。
//
// 架构位置：
//   - 前端会发送 X-Renewlet-Locale，后端 route 和 Validate 使用 requestLocale 输出本地化错误。
//   - 没有显式 header 时回退到 Accept-Language，最后默认英文。
import (
	"net/http"
	"strings"
)

type appLocale string

const (
	localeZhCN appLocale = "zh-CN"
	localeEnUS appLocale = "en-US"
)

// requestLocale 从请求头选择本地化语言。
// X-Renewlet-Locale 优先级高于 Accept-Language，确保前端设置页语言能控制 API 错误文案。
func requestLocale(req *http.Request) appLocale {
	if req == nil {
		return defaultAppLocale
	}
	if locale := strings.TrimSpace(req.Header.Get("X-Renewlet-Locale")); locale != "" {
		if matched, ok := matchAppLocale(locale); ok {
			return matched
		}
		return defaultAppLocale
	}
	return acceptLanguageLocale(req.Header.Get("Accept-Language"))
}

func acceptLanguageLocale(header string) appLocale {
	return matchAcceptLanguage(header)
}
