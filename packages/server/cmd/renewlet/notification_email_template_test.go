package main

import (
	"encoding/json"
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
		"Renewlet 订阅提醒",
		"今日提醒",
		"即将续费: <strong",
		"即将续费",
		"试用结束",
		"已过期",
		"Renewal",
		"18 CNY",
		"2026-05-17",
		emailThemeFromSettings(settings).Primary,
	)
	assertNotContainsAny(t, body, "display:flex", "display: flex", "display:grid", "display: grid", "ZgotmplZ")
	assertNotContainsAny(t, body, `padding:26px 32px; background-color`, `border-radius:999px`)
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
		`<html lang="en">`,
		"Renewlet test notification",
		"Channel check",
		"Message",
		"If you received this message",
		"Generated at",
	)
}

func TestBuildEmailHTMLMessageDoesNotDuplicateTestStatusChip(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
	message := buildTestNotification(time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings)
	body := mustBuildEmailHTML(t, settings, message)

	if got := strings.Count(body, "配置检查"); got != 1 {
		t.Fatalf("expected status label once, got %d\n%s", got, body)
	}
	assertContainsAll(t, body, "Renewlet 测试通知")
	assertNotContainsAny(t, body, `border-radius:999px`)
}

func TestBuildEmailHTMLMessageRendersReminderCTAFromAppURL(t *testing.T) {
	t.Setenv("APP_URL", "https://renewlet.example/app/")
	settings := defaultAppSettings()
	message := buildDueNotificationForLocalDate("2026-05-14", time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings, []notificationSubscription{
		{ID: "renewal", Name: "Renewal", Price: 18, Currency: "CNY", Status: "active", NextBillingDate: "2026-05-17", ReminderDays: 3},
	}, true)

	body := mustBuildEmailHTML(t, settings, message)

	assertContainsAll(t, body, `href="https://renewlet.example/app/subscriptions"`, "查看订阅")
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
		"No reminders",
		"Message",
		"No subscriptions need reminders today.",
	)
}

func TestBuildEmailHTMLMessageCapsLargeHTMLBody(t *testing.T) {
	t.Setenv("APP_URL", "")
	settings := defaultAppSettings()
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
	assertContainsAll(t, body, "内容较长", "消息内容", "提醒项目:", ">800</strong>")
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
	t.Setenv("APP_URL", "")
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

func TestEmailCatalogsHaveSameKeysAndNoEmptyValues(t *testing.T) {
	zhCN := readEmailCatalogMap(t, "zh-CN")
	enUS := readEmailCatalogMap(t, "en-US")

	if len(zhCN) != len(enUS) {
		t.Fatalf("expected locale catalogs to have same key count, zh-CN=%d en-US=%d", len(zhCN), len(enUS))
	}
	for key, zhValue := range zhCN {
		if strings.TrimSpace(zhValue) == "" {
			t.Fatalf("expected zh-CN catalog key %q to be non-empty", key)
		}
		enValue, ok := enUS[key]
		if !ok {
			t.Fatalf("expected en-US catalog to contain key %q", key)
		}
		if strings.TrimSpace(enValue) == "" {
			t.Fatalf("expected en-US catalog key %q to be non-empty", key)
		}
	}
	for key := range enUS {
		if _, ok := zhCN[key]; !ok {
			t.Fatalf("expected zh-CN catalog to contain key %q", key)
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

func readEmailCatalogMap(t *testing.T, locale string) map[string]string {
	t.Helper()
	data, err := emailTemplateFS.ReadFile("i18n/email." + locale + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog map[string]string
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	return catalog
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
