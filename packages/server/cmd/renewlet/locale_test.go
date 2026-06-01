package main

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
}

func TestAcceptLanguageLocaleUsesHighestQualitySupportedLanguage(t *testing.T) {
	if got := acceptLanguageLocale("en-US;q=0.7, zh-CN;q=0.9"); got != localeZhCN {
		t.Fatalf("expected zh-CN, got %s", got)
	}
	if got := acceptLanguageLocale("fr-FR, en;q=0.8"); got != localeEnUS {
		t.Fatalf("expected en-US, got %s", got)
	}
}
