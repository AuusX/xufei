package main

// Go 邮件模板测试保护与 Worker/shared 邮件语义一致的 HTML/Text fallback、CTA、安全转义和服务端 i18n key。

import (
	"math"
	"strings"
	"testing"
	"time"
)

func TestBuildEmailHTMLMessageRendersCompatibleReminderTemplate(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
	settings.ShowExpired = true
	settings.Timezone = "Asia/Shanghai"
	settings.ThemeVariant = "ocean"

	// 邮件 HTML 需要兼容保守客户端，table 布局和内联样式比普通 Web CSS 更重要。
	message := buildDueNotificationForLocalDate("2026-05-14", time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings, []notificationSubscription{
		{ID: "renewal", Name: "Renewal", Price: 18, Currency: "CNY", Status: "active", NextBillingDate: "2026-05-17", ReminderDays: 3},
		{ID: "trial", Name: "Trial", Price: 9.9, Currency: "USD", Status: "trial", NextBillingDate: "2026-06-01", TrialEndDate: "2026-05-15", ReminderDays: 1},
		{ID: "expired", Name: "Expired", Price: 12, Currency: "EUR", Status: "active", NextBillingDate: "2026-05-01", ReminderDays: 7},
	}, true)

	body := mustBuildEmailHTML(t, settings, message)

	assertContainsAll(t, body,
		`<table role="presentation"`,
		`width="600"`,
		`style="`,
		`<html lang="zh-CN">`,
		"Renewlet",
		"<title>Renewlet 订阅提醒</title>",
		"即将续费 <strong",
		"即将续费",
		"试用结束",
		"已过期",
		"Renewal",
		"18 CNY",
		"2026-05-17",
		emailThemeFromSettings(settings).Primary,
		`class="email-container email-card email-ledger"`,
		`class="email-ledger-summary email-rule"`,
		`class="email-panel email-ledger-table"`,
		`colspan="2"`,
		`border-radius:12px`,
		`border-left:2px solid`,
		`@media (prefers-color-scheme: dark)`,
		"#F9FAFB",
		"#FFFFFF",
		"#E3E7ED",
		"#171C26",
		"#6C7993",
		"#0C0E12",
		"#13161B",
		"#23272E",
		"#1F2229",
		"#F0F2F5",
		"#9AA6B8",
	)
	assertNotContainsAny(t, body, "display:flex", "display: flex", "display:grid", "display: grid", "ZgotmplZ")
	assertNotContainsAny(t, body,
		"今日提醒",
		`<h1`,
		`class="email-panel email-ledger-section"`,
		`font-size:18px; font-weight:700; line-height:24px`,
		`padding:26px 32px; background-color`,
		`class="email-chip"`,
		`bgcolor="#111720"`,
		`background-color:#111720`,
		`width:36px; height:36px; border-radius:10px`,
		`border-radius:999px`,
		`<td height="4" style="height:4px; font-size:0; line-height:0; background-color:`,
		`font-size:14px; font-weight:800; line-height:28px;">R</td>`,
		`font-size:20px; font-weight:700; line-height:26px`,
		`font-weight:800`,
		`<img`,
		`<svg`,
		`background-image`,
	)
	if len(body) >= emailMaxHTMLBytes {
		t.Fatalf("expected email html below clipping guard, got %d bytes", len(body))
	}
}

func TestBuildEmailHTMLMessageRendersEnglishTestNotification(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
	settings.Locale = string(localeEnUS)
	settings.Timezone = "UTC"

	message := buildTestNotification(time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings)
	body := mustBuildEmailHTML(t, settings, message)

	assertContainsAll(t, body,
		`<html lang="en-US">`,
		"Renewlet test notification",
		"Message",
		"If you received this message",
		"Generated at",
	)
	assertNotContainsAny(t, body, "Channel check", "<h1", `class="email-ledger-summary email-rule"`, "Reminder items")
}

func TestBuildEmailHTMLMessageOmitsVisibleStatusTitleHero(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
	message := buildTestNotification(time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings)
	body := mustBuildEmailHTML(t, settings, message)

	if got := strings.Count(body, "配置检查"); got != 0 {
		t.Fatalf("expected status label to stay out of visible html, got %d\n%s", got, body)
	}
	assertContainsAll(t, body, "<title>Renewlet 测试通知</title>", "消息内容")
	assertNotContainsAny(t, body, `<h1`, `>Renewlet 测试通知</h1>`, `class="email-chip"`, `border-radius:999px`, `font-size:14px; font-weight:800; line-height:28px;">R</td>`)
}

func TestBuildEmailHTMLMessageRendersReminderCTAFromAppURL(t *testing.T) {
	t.Setenv("APP_URL", "https://renewlet.example/app/")
	settings := defaultAppSettings()
	message := buildDueNotificationForLocalDate("2026-05-14", time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings, []notificationSubscription{
		{ID: "renewal", Name: "Renewal", Price: 18, Currency: "CNY", Status: "active", NextBillingDate: "2026-05-17", ReminderDays: 3},
	}, true)

	body := mustBuildEmailHTML(t, settings, message)

	assertContainsAll(t, body, `href="https://renewlet.example/app/subscriptions"`, "查看订阅", `line-height:38px`)
	assertNotContainsAny(t, body, "打开通知设置")
	if got := strings.Count(body, "<a href="); got != 1 {
		t.Fatalf("expected a single CTA link, got %d\n%s", got, body)
	}
}

func TestBuildEmailHTMLMessageRendersSettingsCTAForTestNotification(t *testing.T) {
	t.Setenv("APP_URL", "https://renewlet.example")
	settings := defaultAppSettings()
	settings.Locale = string(localeEnUS)
	message := buildTestNotification(time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings)

	body := mustBuildEmailHTML(t, settings, message)

	assertContainsAll(t, body, `href="https://renewlet.example/settings"`, "Open notification settings")
	assertNotContainsAny(t, body, "View subscriptions")
	if got := strings.Count(body, "<a href="); got != 1 {
		t.Fatalf("expected a single CTA link, got %d\n%s", got, body)
	}
}

func TestBuildEmailHTMLMessageOmitsCTAForInvalidAppURL(t *testing.T) {
	t.Setenv("APP_URL", "javascript:alert(1)")
	settings := defaultAppSettings()
	message := buildTestNotification(time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings)

	body := mustBuildEmailHTML(t, settings, message)

	assertNotContainsAny(t, body, "<a href=", "查看订阅", "打开通知设置", "javascript:alert")
}

func TestBuildEmailHTMLMessageEscapesUserContentAndOmitsLogoURL(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
	message := notificationMessage{
		Title:     `<script>alert("title")</script>`,
		Content:   "Line <b>one</b>\nLine two",
		Timestamp: `2026-05-14 08:00:00 Asia/Shanghai`,
		Items: []notificationContentItem{{
			Type:         "renewal",
			Name:         `<img src=x onerror=alert(1)>`,
			LogoURL:      "https://cdn.example.com/private-logo.png",
			Price:        8,
			Currency:     `<USD>`,
			TargetDate:   `2026-05-17`,
			ReminderDays: 3,
		}},
		HasPayload: true,
	}

	body := mustBuildEmailHTML(t, settings, message)

	assertContainsAll(t, body,
		`&lt;script&gt;alert(&#34;title&#34;)&lt;/script&gt;`,
		`&lt;img src=x onerror=alert(1)&gt;`,
		`&lt;USD&gt;`,
	)
	assertNotContainsAny(t, body, "<script", "</script>", "<img", "https://cdn.example.com/private-logo.png")
}

func TestBuildEmailHTMLMessageEscapesPlainContentLines(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
	message := notificationMessage{
		Title:      "Renewlet 测试通知",
		Content:    "Line <b>one</b>\nLine two",
		Timestamp:  "2026-05-14 08:00:00 UTC",
		Items:      []notificationContentItem{},
		HasPayload: true,
	}

	body := mustBuildEmailHTML(t, settings, message)

	assertContainsAll(t, body, `Line &lt;b&gt;one&lt;/b&gt;<br>Line two`)
	assertNotContainsAny(t, body, "<b>one</b>")
}

func TestBuildEmailHTMLMessageRendersEmptyNotificationContent(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
	settings.Locale = string(localeEnUS)
	message := notificationMessage{
		Title:      "Renewlet subscription reminder",
		Content:    "No subscriptions need reminders today.",
		Timestamp:  "2026-05-14 08:00:00 UTC",
		Items:      []notificationContentItem{},
		HasPayload: false,
	}

	body := mustBuildEmailHTML(t, settings, message)

	assertContainsAll(t, body,
		"Message",
		"No subscriptions need reminders today.",
	)
	assertNotContainsAny(t, body, "No reminders", "Reminder items", `class="email-ledger-summary email-rule"`)
}

func TestBuildEmailHTMLMessageCapsLargeHTMLBody(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
	// 邮件客户端常按体积截断 HTML；超长通知必须降级到 compact 视图，而不是继续膨胀完整列表。
	items := make([]notificationContentItem, 0, 800)
	for i := 0; i < 800; i++ {
		items = append(items, notificationContentItem{
			Type:         "renewal",
			Name:         "Very Long Subscription Name",
			Price:        18,
			Currency:     "CNY",
			TargetDate:   "2026-05-17",
			ReminderDays: 3,
		})
	}
	message := notificationMessage{
		Title:      "Renewlet 订阅提醒",
		Content:    strings.Repeat("即将续费：Renewlet\n", 2000),
		Timestamp:  "2026-05-14 08:00:00 UTC",
		Items:      items,
		HasPayload: true,
	}

	body := mustBuildEmailHTML(t, settings, message)

	if len(body) >= emailMaxHTMLBytes {
		t.Fatalf("expected compact email html below clipping guard, got %d bytes", len(body))
	}
	assertContainsAll(t, body, "内容较长", "消息内容", "提醒项目", ">800</strong>")
}

func TestEmailThemeFromSettingsMapsVariantsAndCustomColor(t *testing.T) {
	settings := defaultAppSettings()
	settings.ThemeVariant = "rose"
	if got, want := emailThemeFromSettings(settings).Primary, hslToHex(340, 75, 50); got != want {
		t.Fatalf("expected rose primary %s, got %s", want, got)
	}

	settings.ThemeVariant = "custom"
	settings.ThemeCustomColor = themeCustomColor{H: 210, S: 90, L: 45}
	if got, want := emailThemeFromSettings(settings).Primary, hslToHex(210, 90, 45); got != want {
		t.Fatalf("expected custom primary %s, got %s", want, got)
	}

	settings.ThemeCustomColor = themeCustomColor{H: math.NaN(), S: 90, L: 45}
	if got, want := emailThemeFromSettings(settings).Primary, hslToHex(160, 84, 39); got != want {
		t.Fatalf("expected invalid custom color to fall back to emerald %s, got %s", want, got)
	}
}

func TestEmailThemesRenderWithoutTemplateCSSSanitizerFailures(t *testing.T) {
	t.Setenv("APP_URL", "https://renewlet.example")
	for _, variant := range []string{"emerald", "ocean", "sunset", "lavender", "rose", "custom"} {
		t.Run(variant, func(t *testing.T) {
			settings := defaultAppSettings()
			settings.ThemeVariant = variant
			if variant == "custom" {
				settings.ThemeCustomColor = themeCustomColor{H: 210, S: 90, L: 45}
			}
			body := mustBuildEmailHTML(t, settings, buildTestNotification(time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings))

			assertContainsAll(t, body, emailThemeFromSettings(settings).Primary)
			assertNotContainsAny(t, body, "ZgotmplZ")
		})
	}
}

func TestServerI18nCatalogsHaveSameKeysAndNoEmptyValues(t *testing.T) {
	base := serverI18nCatalogs[defaultAppLocale]

	for locale, catalog := range serverI18nCatalogs {
		if len(catalog) != len(base) {
			t.Fatalf("expected locale catalogs to have same key count, %s=%d %s=%d", defaultAppLocale, len(base), locale, len(catalog))
		}
		for key := range base {
			value, ok := catalog[key]
			if !ok {
				t.Fatalf("expected %s catalog to contain key %q", locale, key)
			}
			if strings.TrimSpace(value) == "" {
				t.Fatalf("expected %s catalog key %q to be non-empty", locale, key)
			}
		}
		for key := range catalog {
			if _, ok := base[key]; !ok {
				t.Fatalf("expected %s catalog to contain key %q", defaultAppLocale, key)
			}
		}
	}
}

func TestEmailPlainTextFallbackContentRemainsAvailable(t *testing.T) {
	message := notificationMessage{
		Title:     "Renewlet subscription reminder",
		Content:   "Upcoming renewals:\n- Renewal: 2026-05-17, 18 CNY (3 days before)",
		Timestamp: "2026-05-14 08:00:00 UTC",
	}

	plain := buildEmailTextBody(message)
	assertContainsAll(t, plain, "Upcoming renewals", "2026-05-14 08:00:00 UTC")
}

func mustBuildEmailHTML(t *testing.T, settings appSettings, message notificationMessage) string {
	t.Helper()
	body, err := buildEmailHTMLMessage(settings, message)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func assertContainsAll(t *testing.T, body string, parts ...string) {
	t.Helper()
	for _, part := range parts {
		if !strings.Contains(body, part) {
			t.Fatalf("expected body to contain %q\n%s", part, body)
		}
	}
}

func assertNotContainsAny(t *testing.T, body string, parts ...string) {
	t.Helper()
	for _, part := range parts {
		if strings.Contains(body, part) {
			t.Fatalf("expected body not to contain %q\n%s", part, body)
		}
	}
}
