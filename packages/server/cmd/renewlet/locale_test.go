package main

// 服务端 locale 测试保护 X-Renewlet-Locale 优先级和 catalog placeholder；通知/错误文案不能依赖前端 Lingui runtime。

import (
	"net/http"
	"testing"
)

func TestRequestLocalePrefersExplicitHeader(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/api/app/example", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	req.Header.Set("X-Renewlet-Locale", "en-US")

	if got := requestLocale(req); got != localeEnUS {
		t.Fatalf("expected en-US, got %s", got)
	}

	req.Header.Set("X-Renewlet-Locale", "en-GB")
	if got := requestLocale(req); got != localeEnUS {
		t.Fatalf("expected en-US for matched explicit header, got %s", got)
	}

	req.Header.Set("X-Renewlet-Locale", "fr-FR")
	if got := requestLocale(req); got != localeZhCN {
		t.Fatalf("expected invalid explicit header to fall back to default locale, got %s", got)
	}
}

func TestAcceptLanguageLocaleUsesHighestQualitySupportedLanguage(t *testing.T) {
	if got := acceptLanguageLocale("en-US;q=0.7, zh-CN;q=0.9"); got != localeZhCN {
		t.Fatalf("expected zh-CN, got %s", got)
	}
	if got := acceptLanguageLocale("fr-FR, en;q=0.8"); got != localeEnUS {
		t.Fatalf("expected en-US, got %s", got)
	}
	if got := acceptLanguageLocale("en-GB, zh-CN;q=0.2"); got != localeEnUS {
		t.Fatalf("expected en-US for en-GB, got %s", got)
	}
	if got := acceptLanguageLocale("en-US;q=0, zh-Hant;q=0.8"); got != localeZhCN {
		t.Fatalf("expected zh-CN for zh-Hant fallback, got %s", got)
	}
}

func TestServerI18nLocalizer(t *testing.T) {
	if got := normalizeAppLocale("en-GB"); got != localeEnUS {
		t.Fatalf("expected en-US, got %s", got)
	}
	if got := serverText(localeEnUS, "common.requestBodyTooLarge"); got != "Request body is too large" {
		t.Fatalf("unexpected localized text: %q", got)
	}
	if got := serverFormat(localeZhCN, "common.requiredField", map[string]interface{}{"label": "Webhook URL"}); got != "Webhook URL 不能为空" {
		t.Fatalf("unexpected formatted text: %q", got)
	}
	if got := serverFormat(localeEnUS, "notification.content.itemLine", map[string]interface{}{
		"name":       "Acme",
		"targetDate": "2026-05-17",
		"amount":     "18",
		"currency":   "USD",
		"extra":      "3 days before",
	}); got != "- Acme: 2026-05-17, 18 USD (3 days before)" {
		t.Fatalf("unexpected named placeholder output: %q", got)
	}
	if got := serverText(localeEnUS, "missing.key"); got != "missing.key" {
		t.Fatalf("expected missing key fallback, got %q", got)
	}
}
