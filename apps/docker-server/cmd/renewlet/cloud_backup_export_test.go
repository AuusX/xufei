package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCloudBackupExportSettingsStripsExternalNotificationSecrets(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	user, _ := createRouteTestUser(t, app, "cloud-backup-export")
	settings := defaultAppSettings()
	settings.DiscordWebhookURL = "https://discord.com/api/webhooks/123/secret"
	settings.DiscordBotUsername = "Renewlet"
	settings.DiscordBotAvatarURL = "https://cdn.example.com/avatar.png"
	settings.PushPlusToken = "push-token"
	settings.DingTalkWebhookURL = "https://oapi.dingtalk.com/robot/send?access_token=ding-token"
	settings.DingTalkSecret = "SECsecret"
	settings.DingTalkKeyword = "自定义关键词"
	settings.DingTalkTitleTemplate = "自定义标题"
	settings.DingTalkContentTemplate = "自定义正文"
	if _, err := createSettingsRecord(app, user.Id, settings); err != nil {
		t.Fatal(err)
	}

	exported, ok, err := cloudBackupExportSettings(app, user)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected settings to be exported")
	}
	for _, key := range []string{"discordWebhookUrl", "discordBotUsername", "discordBotAvatarUrl", "pushplusToken", "dingtalkWebhookUrl", "dingtalkSecret", "dingtalkKeyword", "dingtalkTitleTemplate", "dingtalkContentTemplate"} {
		if _, exists := exported[key]; exists {
			t.Fatalf("expected %s to be stripped from cloud backup settings: %#v", key, exported)
		}
	}
	for _, forbidden := range []string{"ding-token", "SECsecret", "自定义关键词", "自定义标题", "自定义正文"} {
		if strings.Contains(jsonStringForTest(exported), forbidden) {
			t.Fatalf("cloud backup settings leaked %q: %#v", forbidden, exported)
		}
	}
}

func jsonStringForTest(value interface{}) string {
	data, _ := json.Marshal(value)
	return string(data)
}
