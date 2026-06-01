package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func TestImportPreviewRequiresAuth(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/preview", `{}`, "")
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized preview, got %d: %s", res.Code, res.Body.String())
	}
}

func TestImportApplyCreatesAndSkipsByImportKey(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "user")
	body := importRequestBody("skip", 12)

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", body, token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected apply 200, got %d: %s", res.Code, res.Body.String())
	}
	if count := subscriptionCountForUser(t, app, user.Id); count != 1 {
		t.Fatalf("subscription count = %d, want 1", count)
	}

	res = serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", body, token)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"skips":1`) {
		t.Fatalf("expected second apply to skip, got %d: %s", res.Code, res.Body.String())
	}
	if count := subscriptionCountForUser(t, app, user.Id); count != 1 {
		t.Fatalf("subscription count after skip = %d, want 1", count)
	}
}

func TestImportApplyReplacesCurrentUserRecord(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "user")
	if res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", importRequestBody("skip", 12), token); res.Code != http.StatusOK {
		t.Fatalf("seed apply failed: %d %s", res.Code, res.Body.String())
	}

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", importRequestBody("replace", 99), token)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"replaces":1`) {
		t.Fatalf("expected replace apply, got %d: %s", res.Code, res.Body.String())
	}
	rows, err := app.FindAllRecords("subscriptions", dbx.HashExp{"user": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].GetFloat("price") != 99 {
		t.Fatalf("expected one replaced record with price 99, got rows=%d price=%v", len(rows), rows[0].GetFloat("price"))
	}
}

func TestImportPreviewRejectsUnknownFields(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, token := createRouteTestUser(t, app, "user")
	body := strings.TrimSuffix(importRequestBody("skip", 12), "}") + `,"unexpected":true}`

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/preview", body, token)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected unknown field to fail, got %d: %s", res.Code, res.Body.String())
	}
}

func TestImportApplyDoesNotReplaceOtherUserRecord(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	firstUser, firstToken := createRouteTestUser(t, app, "first")
	secondUser, secondToken := createRouteTestUser(t, app, "second")
	body := importRequestBody("replace", 12)

	if res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", body, firstToken); res.Code != http.StatusOK {
		t.Fatalf("first apply failed: %d %s", res.Code, res.Body.String())
	}
	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", importRequestBody("replace", 99), secondToken)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"creates":1`) {
		t.Fatalf("expected same import key to create for second user, got %d: %s", res.Code, res.Body.String())
	}
	if count := subscriptionCountForUser(t, app, firstUser.Id); count != 1 {
		t.Fatalf("first user count = %d, want 1", count)
	}
	if count := subscriptionCountForUser(t, app, secondUser.Id); count != 1 {
		t.Fatalf("second user count = %d, want 1", count)
	}
}

func TestImportApplyMatchesRenewletSourceIdToCurrentRecordId(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "user")
	existing := saveSubscriptionRecord(t, app, user.Id, []interface{}{}, "Existing Renewlet")

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", importRequestBodyWithSource("replace", "renewlet", existing.Id, 88), token)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"replaces":1`) {
		t.Fatalf("expected Renewlet id match to replace, got %d: %s", res.Code, res.Body.String())
	}
	rows, err := app.FindAllRecords("subscriptions", dbx.HashExp{"user": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Id != existing.Id || rows[0].GetFloat("price") != 88 {
		t.Fatalf("expected existing record replaced by id, got rows=%d id=%q price=%v", len(rows), rows[0].Id, rows[0].GetFloat("price"))
	}
}

func TestImportApplyPreservesInheritedReminderDays(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "user")

	body := importRequestBodyWithReminderDays("skip", "renewlet", "renewlet-sub-1", inheritReminderDays, 12)
	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", body, token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected inherited reminder import apply 200, got %d: %s", res.Code, res.Body.String())
	}
	rows, err := app.FindAllRecords("subscriptions", dbx.HashExp{"user": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].GetInt("reminderDays") != inheritReminderDays {
		t.Fatalf("expected inherited reminder days to be preserved, got rows=%d reminderDays=%d", len(rows), rows[0].GetInt("reminderDays"))
	}
}

func TestImportPreviewMarksDuplicateSourceId(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, token := createRouteTestUser(t, app, "user")

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/preview", importRequestBodyWithSource("skip", "wallos", "1:42", 12, 13), token)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"errors":1`) || !strings.Contains(res.Body.String(), "IMPORT_SOURCE_ID_DUPLICATE") {
		t.Fatalf("expected duplicate source id preview error, got %d: %s", res.Code, res.Body.String())
	}
}

func TestImportApplyAcceptsOneTimeBillingCycle(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "user")

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", importRequestBodyWithBillingCycle("skip", "one-time", nil, true, 199), token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected one-time import apply 200, got %d: %s", res.Code, res.Body.String())
	}
	rows, err := app.FindAllRecords("subscriptions", dbx.HashExp{"user": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].GetString("billingCycle") != "one-time" || rows[0].GetInt("customDays") != 0 || rows[0].GetBool("autoCalculateNextBillingDate") {
		t.Fatalf("expected one-time record normalized, got rows=%d cycle=%q customDays=%d auto=%v", len(rows), rows[0].GetString("billingCycle"), rows[0].GetInt("customDays"), rows[0].GetBool("autoCalculateNextBillingDate"))
	}
}

func TestImportApplyHonorsManualSkipIndex(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "user")

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", importRequestBodyWithSkipIndexes("skip", []int{0}, 12), token)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"skips":1`) {
		t.Fatalf("expected manual skip, got %d: %s", res.Code, res.Body.String())
	}
	if count := subscriptionCountForUser(t, app, user.Id); count != 0 {
		t.Fatalf("subscription count after manual skip = %d, want 0", count)
	}
}

func TestImportPreviewMatchesLowConfidenceWallosByName(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	_, token := createRouteTestUser(t, app, "user")
	if res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/apply", importRequestBodyWithOptions("skip", "wallos", "display:old", "low", nil, 12), token); res.Code != http.StatusOK {
		t.Fatalf("seed low confidence import failed: %d %s", res.Code, res.Body.String())
	}

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/import/preview", importRequestBodyWithOptions("skip", "wallos", "display:new", "low", nil, 99), token)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"skips":1`) || !strings.Contains(res.Body.String(), importWarningLowConfidenceNameMatched) {
		t.Fatalf("expected low-confidence name fallback skip, got %d: %s", res.Code, res.Body.String())
	}
}

func subscriptionCountForUser(t *testing.T, app core.App, userID string) int {
	t.Helper()
	rows, err := app.FindAllRecords("subscriptions", dbx.HashExp{"user": userID})
	if err != nil {
		t.Fatal(err)
	}
	return len(rows)
}

func importRequestBody(conflictMode string, price int) string {
	return importRequestBodyWithSource(conflictMode, "wallos", "1:42", price)
}

func importRequestBodyWithSource(conflictMode string, source string, sourceID string, prices ...int) string {
	return importRequestBodyWithOptions(conflictMode, source, sourceID, "high", nil, prices...)
}

func importRequestBodyWithSkipIndexes(conflictMode string, skipIndexes []int, prices ...int) string {
	return importRequestBodyWithOptions(conflictMode, "wallos", "1:42", "high", skipIndexes, prices...)
}

func importRequestBodyWithBillingCycle(conflictMode string, billingCycle string, customDays *int, autoCalculate bool, prices ...int) string {
	body := importRequestBodyWithOptions(conflictMode, "wallos", "1:42", "high", nil, prices...)
	var decoded map[string]interface{}
	_ = json.Unmarshal([]byte(body), &decoded)
	payload := decoded["payload"].(map[string]interface{})
	subscriptions := payload["subscriptions"].([]interface{})
	for _, item := range subscriptions {
		subscription := item.(map[string]interface{})
		subscription["billingCycle"] = billingCycle
		subscription["customDays"] = customDays
		subscription["autoCalculateNextBillingDate"] = autoCalculate
	}
	data, _ := json.Marshal(decoded)
	return string(data)
}

func importRequestBodyWithReminderDays(conflictMode string, source string, sourceID string, reminderDays int, prices ...int) string {
	body := importRequestBodyWithOptions(conflictMode, source, sourceID, "high", nil, prices...)
	var decoded map[string]interface{}
	_ = json.Unmarshal([]byte(body), &decoded)
	payload := decoded["payload"].(map[string]interface{})
	subscriptions := payload["subscriptions"].([]interface{})
	for _, item := range subscriptions {
		subscription := item.(map[string]interface{})
		subscription["reminderDays"] = reminderDays
	}
	data, _ := json.Marshal(decoded)
	return string(data)
}

func importRequestBodyWithOptions(conflictMode string, source string, sourceID string, confidence string, skipIndexes []int, prices ...int) string {
	subscriptions := make([]map[string]interface{}, 0, len(prices))
	for _, price := range prices {
		subscriptions = append(subscriptions, map[string]interface{}{
			"name":                         "GitHub",
			"logo":                         nil,
			"price":                        price,
			"currency":                     "USD",
			"billingCycle":                 "monthly",
			"customDays":                   nil,
			"category":                     "developer_tools",
			"status":                       "active",
			"paymentMethod":                nil,
			"startDate":                    "2026-01-01",
			"nextBillingDate":              "2026-02-01",
			"autoCalculateNextBillingDate": true,
			"trialEndDate":                 nil,
			"website":                      nil,
			"notes":                        nil,
			"tags":                         []string{},
			"reminderDays":                 3,
			"repeatReminderEnabled":        false,
			"repeatReminderInterval":       "1h",
			"repeatReminderWindow":         "72h",
			"extra": map[string]interface{}{
				"import": map[string]interface{}{
					"source":     source,
					"sourceId":   sourceID,
					"confidence": confidence,
				},
			},
		})
	}
	body := map[string]interface{}{
		"conflictMode": conflictMode,
		"payload": map[string]interface{}{
			"source":        source,
			"subscriptions": subscriptions,
		},
	}
	if skipIndexes != nil {
		body["skipIndexes"] = skipIndexes
	}
	data, _ := json.Marshal(body)
	return string(data)
}
