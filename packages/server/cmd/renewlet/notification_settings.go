package main

// notification_settings.go 处理 settings JSON 到通知领域设置的严格收敛。
//
// 架构位置：PocketBase JSON 字段、测试请求中的临时 patch 都必须先经过这里，
// 再进入消息构建或渠道发送，避免动态 JSON 在业务层扩散。
//
// 注意： sanitizeSettings 只做可恢复兜底；route body 的未知字段和非法类型仍应在 strict decoder 阶段失败。
import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// currentUserSettings 读取当前用户设置，并合并请求级临时 patch。
// 注意： 该函数服务于通知测试/手动运行；不要在这里持久化 patch。
func currentUserSettings(app core.App, user *core.Record, patch json.RawMessage) (appSettings, error) {
	settings := defaultAppSettings()
	if user == nil {
		return settings, nil
	}
	record, err := app.FindFirstRecordByFilter("settings", "user = {:user}", dbx.Params{"user": user.Id})
	if err == nil && record != nil {
		settings = settingsFromRecord(record)
	}
	if len(bytes.TrimSpace(patch)) == 0 {
		return settings, nil
	}
	return mergeSettings(settings, patch)
}

// settingsFromRecord 从 PocketBase settings 记录读取强类型设置。
func settingsFromRecord(record *core.Record) appSettings {
	settings, err := settingsFromValue(record.Get("settings"))
	if err != nil {
		return defaultAppSettings()
	}
	return settings
}

// settingsFromValue 将 PocketBase JSON 字段转换为 appSettings。
func settingsFromValue(value interface{}) (appSettings, error) {
	settings := defaultAppSettings()
	data, err := jsonBytesFromValue(value)
	if err != nil || len(bytes.TrimSpace(data)) == 0 {
		return settings, err
	}
	return mergeSettings(settings, json.RawMessage(data))
}

// mergeSettings 将 patch 严格解码到默认/当前设置上。
// 使用完整 appSettings 目标而非 map，是为了让未知字段和非法类型在边界失败。
func mergeSettings(base appSettings, patch json.RawMessage) (appSettings, error) {
	if len(bytes.TrimSpace(patch)) == 0 {
		return base, nil
	}
	settings := base
	sourcePatch, err := decodeBuiltInIconSourcePatch(patch, base.Locale)
	if err != nil {
		return base, err
	}
	if err := decodeStrictJSONBytesInto(patch, &settings, normalizeAppLocale(base.Locale), false); err != nil {
		return base, err
	}
	settings.BuiltInIconSources = mergeBuiltInIconSourceSettings(base.BuiltInIconSources, sourcePatch)
	if !hasEnabledBuiltInIconSource(settings.BuiltInIconSources) {
		return base, errors.New("BUILT_IN_ICON_SOURCE_REQUIRED")
	}
	return sanitizeSettings(settings), nil
}

// sanitizeSettings 对可恢复的设置值做保守归一。
// 注意： 这里只修复默认值/枚举兜底，不应吞掉 route body 的严格校验职责。
func sanitizeSettings(settings appSettings) appSettings {
	if !isSupportedAppLocale(settings.Locale) {
		settings.Locale = string(normalizeAppLocale(settings.Locale))
	}
	if settings.ExchangeRateProvider == "frankfurter" {
		settings.ExchangeRateProvider = "exchange-api"
	}
	if settings.ExchangeRateProvider != "floatrates" && settings.ExchangeRateProvider != "exchange-api" {
		settings.ExchangeRateProvider = "floatrates"
	}
	settings.BuiltInIconSources = sanitizeBuiltInIconSources(settings.BuiltInIconSources)
	if _, err := time.LoadLocation(settings.Timezone); err != nil {
		settings.Timezone = "UTC"
	}
	if !isValidLocalTime(settings.NotificationTimeLocal) {
		settings.NotificationTimeLocal = "08:00"
	}
	settings.NotificationReminderDays = normalizeNotificationReminderDays(settings.NotificationReminderDays)
	settings.EnabledChannels = uniqueValidChannels(settings.EnabledChannels)
	if settings.WebhookMethod != "GET" && settings.WebhookMethod != "POST" {
		settings.WebhookMethod = "POST"
	}
	settings.WebhookHeaders = clearLegacyWebhookExample(settings.WebhookHeaders, legacyWebhookHeadersExample)
	settings.WebhookPayload = clearLegacyWebhookExample(settings.WebhookPayload, legacyWebhookPayloadExample)
	if settings.WechatMessageType != "markdown" && settings.WechatMessageType != "text" {
		settings.WechatMessageType = "text"
	}
	if strings.TrimSpace(settings.BarkServerURL) == "" {
		settings.BarkServerURL = "https://api.day.app"
	}
	return settings
}

func sanitizeBuiltInIconSources(settings builtInIconSourceSettings) builtInIconSourceSettings {
	out := mergeBuiltInIconSourceSettings(defaultBuiltInIconSourceSettings(), builtInIconSourceSettingsToPatch(settings))
	enabledCount := 0
	for _, setting := range out {
		if setting.Enabled {
			enabledCount++
		}
	}
	if enabledCount == 0 {
		return defaultBuiltInIconSourceSettings()
	}
	return out
}

func decodeBuiltInIconSourcePatch(raw json.RawMessage, locale string) (map[string]builtInIconSourceSettingPatch, error) {
	var envelope map[string]json.RawMessage
	if err := decodeStrictJSONBytesInto(raw, &envelope, normalizeAppLocale(locale), false); err != nil {
		return nil, err
	}
	sourceRaw, ok := envelope["builtInIconSources"]
	if !ok {
		return nil, nil
	}
	if bytes.Equal(bytes.TrimSpace(sourceRaw), []byte("null")) {
		return nil, errors.New("BUILT_IN_ICON_SOURCE_INVALID")
	}
	var sources map[string]builtInIconSourceSettingPatch
	if err := json.Unmarshal(sourceRaw, &sources); err != nil {
		return nil, err
	}
	defaults := defaultBuiltInIconSourceSettings()
	for provider := range sources {
		if _, ok := defaults[provider]; !ok {
			return nil, fmt.Errorf("json: unknown field %q", provider)
		}
	}
	return sources, nil
}

func builtInIconSourceSettingsToPatch(settings builtInIconSourceSettings) map[string]builtInIconSourceSettingPatch {
	patch := map[string]builtInIconSourceSettingPatch{}
	for provider, setting := range settings {
		enabled := setting.Enabled
		variantsEnabled := setting.VariantsEnabled
		patch[provider] = builtInIconSourceSettingPatch{Enabled: &enabled, VariantsEnabled: &variantsEnabled}
	}
	return patch
}

func mergeBuiltInIconSourceSettings(base builtInIconSourceSettings, patch map[string]builtInIconSourceSettingPatch) builtInIconSourceSettings {
	defaults := defaultBuiltInIconSourceSettings()
	out := builtInIconSourceSettings{}
	for provider, defaultSetting := range defaults {
		setting, ok := base[provider]
		if !ok {
			setting = defaultSetting
		}
		if patchSetting, ok := patch[provider]; ok {
			if patchSetting.Enabled != nil {
				setting.Enabled = *patchSetting.Enabled
			}
			if patchSetting.VariantsEnabled != nil {
				setting.VariantsEnabled = *patchSetting.VariantsEnabled
			}
		}
		out[provider] = setting
	}
	return out
}

func (s *builtInIconSourceSettingPatch) UnmarshalJSON(data []byte) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return errors.New("BUILT_IN_ICON_SOURCE_INVALID")
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for key, value := range raw {
		switch key {
		case "enabled":
			var enabled bool
			if err := json.Unmarshal(value, &enabled); err != nil {
				return err
			}
			s.Enabled = &enabled
		case "variantsEnabled":
			var variantsEnabled bool
			if err := json.Unmarshal(value, &variantsEnabled); err != nil {
				return err
			}
			s.VariantsEnabled = &variantsEnabled
		default:
			return fmt.Errorf("json: unknown field %q", key)
		}
	}
	return nil
}

func hasEnabledBuiltInIconSource(settings builtInIconSourceSettings) bool {
	for _, setting := range settings {
		if setting.Enabled {
			return true
		}
	}
	return false
}

func clearLegacyWebhookExample(value, legacyExample string) string {
	if strings.TrimSpace(value) == legacyExample {
		return ""
	}
	return value
}

func uniqueValidChannels(channels []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(channels))
	for _, channel := range channels {
		channel = strings.TrimSpace(channel)
		if _, ok := knownChannels[channel]; !ok {
			continue
		}
		if _, ok := seen[channel]; ok {
			continue
		}
		// 顺序保持用户设置顺序，但去重后发送，避免同一渠道重复推送。
		seen[channel] = struct{}{}
		out = append(out, channel)
	}
	return out
}
