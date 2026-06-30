package main

import (
	"errors"
	"net/url"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	subscriptionListDefaultLimit       = 50
	subscriptionListMaxLimit           = 100
	subscriptionListScanPageSize       = 500
	subscriptionListSearchMaxLength    = 200
	subscriptionPaymentMethodNoneValue = "__none"
)

type subscriptionListQuery struct {
	Limit           int
	Cursor          *subscriptionCursorPayload
	Search          string
	Categories      []string
	Tags            []string
	BillingCycles   []string
	PaymentMethods  []string
	Currencies      []string
	Status          string
	Renewal         string
	NextBillingFrom string
	NextBillingTo   string
	Pinned          *bool
	PublicHidden    *bool
	ReminderMode    string
	RepeatReminder  *bool
}

type subscriptionListPage struct {
	Rows       []*core.Record
	NextCursor *string
	Total      int64
}

func parseSubscriptionListQuery(values url.Values) (subscriptionListQuery, error) {
	limit, err := parsePositiveQueryInt(values.Get("limit"), subscriptionListDefaultLimit, 1, subscriptionListMaxLimit)
	if err != nil {
		return subscriptionListQuery{}, err
	}
	query := subscriptionListQuery{Limit: limit}
	if rawCursor := strings.TrimSpace(values.Get("cursor")); rawCursor != "" {
		cursor, err := parseSubscriptionCursorPayload(rawCursor)
		if err != nil {
			return subscriptionListQuery{}, err
		}
		query.Cursor = &cursor
	}
	if search := strings.TrimSpace(values.Get("q")); search != "" {
		if len(search) > subscriptionListSearchMaxLength {
			return subscriptionListQuery{}, errors.New("invalid search query")
		}
		query.Search = search
	}
	if query.Categories, err = parseSubscriptionListStrings(values["category"], 50, 80, nil); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.Tags, err = parseSubscriptionListStrings(values["tag"], 100, 40, nil); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.BillingCycles, err = parseSubscriptionListStrings(values["billingCycle"], 7, 40, isValidBillingCycle); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.PaymentMethods, err = parseSubscriptionListStrings(values["paymentMethod"], 200, 80, isValidSubscriptionListPaymentMethod); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.Currencies, err = parseSubscriptionListStrings(values["currency"], 50, 3, isSubscriptionListCurrency); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.Status, err = parseSubscriptionListSingle(values, "status", 40, isValidSubscriptionStatus); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.Renewal, err = parseSubscriptionListSingle(values, "renewal", 20, isSubscriptionListRenewal); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.NextBillingFrom, err = parseSubscriptionListSingle(values, "nextBillingFrom", 10, isValidDateOnly); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.NextBillingTo, err = parseSubscriptionListSingle(values, "nextBillingTo", 10, isValidDateOnly); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.NextBillingFrom != "" && query.NextBillingTo != "" && query.NextBillingFrom > query.NextBillingTo {
		return subscriptionListQuery{}, errors.New("invalid next billing range")
	}
	if query.Pinned, err = parseSubscriptionListBool(values, "pinned"); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.PublicHidden, err = parseSubscriptionListBool(values, "publicHidden"); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.ReminderMode, err = parseSubscriptionListSingle(values, "reminderMode", 20, isSubscriptionListReminderMode); err != nil {
		return subscriptionListQuery{}, err
	}
	if query.RepeatReminder, err = parseSubscriptionListBool(values, "repeatReminder"); err != nil {
		return subscriptionListQuery{}, err
	}
	return query, nil
}

func listSubscriptionRecordsForQuery(app core.App, userID string, query subscriptionListQuery, today string) (subscriptionListPage, error) {
	if !query.hasFilters() {
		return listDefaultSubscriptionRecords(app, userID, query)
	}
	total, err := countFilteredSubscriptionRecords(app, userID, query, today)
	if err != nil {
		return subscriptionListPage{}, err
	}
	rows, err := collectFilteredSubscriptionPage(app, userID, query, today)
	if err != nil {
		return subscriptionListPage{}, err
	}
	pageRows := rows
	var nextCursor *string
	if len(rows) > query.Limit {
		pageRows = rows[:query.Limit]
		cursor := encodeSubscriptionCursor(pageRows[len(pageRows)-1])
		nextCursor = &cursor
	}
	return subscriptionListPage{Rows: pageRows, NextCursor: nextCursor, Total: total}, nil
}

func listDefaultSubscriptionRecords(app core.App, userID string, query subscriptionListQuery) (subscriptionListPage, error) {
	filter := "user = {:user}"
	params := dbx.Params{"user": userID}
	if query.Cursor != nil {
		filter = "user = {:user} && (created < {:createdAt} || (created = {:createdAt} && id < {:id}))"
		params["createdAt"] = query.Cursor.CreatedAt
		params["id"] = query.Cursor.ID
	}
	// 游标只描述分页位置，不能参与权限判断；所有查询都先按当前 user 过滤。
	rows, err := app.FindRecordsByFilter("subscriptions", filter, "-created,-id", query.Limit+1, 0, params)
	if err != nil {
		return subscriptionListPage{}, err
	}
	pageRows := rows
	var nextCursor *string
	if len(rows) > query.Limit {
		pageRows = rows[:query.Limit]
		cursor := encodeSubscriptionCursor(pageRows[len(pageRows)-1])
		nextCursor = &cursor
	}
	total, err := app.CountRecords("subscriptions", dbx.HashExp{"user": userID})
	if err != nil {
		return subscriptionListPage{}, err
	}
	return subscriptionListPage{Rows: pageRows, NextCursor: nextCursor, Total: total}, nil
}

func countFilteredSubscriptionRecords(app core.App, userID string, query subscriptionListQuery, today string) (int64, error) {
	filter, params := subscriptionListBaseFilter(userID, query, nil)
	var total int64
	offset := 0
	for {
		rows, err := app.FindRecordsByFilter("subscriptions", filter, "-created,-id", subscriptionListScanPageSize, offset, params)
		if err != nil {
			return 0, err
		}
		for _, record := range rows {
			if subscriptionRecordMatchesPostFilters(record, query, today) {
				total++
			}
		}
		if len(rows) < subscriptionListScanPageSize {
			return total, nil
		}
		offset += subscriptionListScanPageSize
	}
}

func collectFilteredSubscriptionPage(app core.App, userID string, query subscriptionListQuery, today string) ([]*core.Record, error) {
	filter, params := subscriptionListBaseFilter(userID, query, query.Cursor)
	rows := make([]*core.Record, 0, query.Limit+1)
	offset := 0
	for len(rows) <= query.Limit {
		candidates, err := app.FindRecordsByFilter("subscriptions", filter, "-created,-id", subscriptionListScanPageSize, offset, params)
		if err != nil {
			return nil, err
		}
		for _, record := range candidates {
			if subscriptionRecordMatchesPostFilters(record, query, today) {
				rows = append(rows, record)
				if len(rows) > query.Limit {
					return rows, nil
				}
			}
		}
		if len(candidates) < subscriptionListScanPageSize {
			return rows, nil
		}
		offset += subscriptionListScanPageSize
	}
	return rows, nil
}

func subscriptionListBaseFilter(userID string, query subscriptionListQuery, cursor *subscriptionCursorPayload) (string, dbx.Params) {
	// 所有可下推条件都必须挂在 owner 过滤之后；标签、搜索和有效状态留给后处理以保持 PocketBase/D1 语义一致。
	conditions := []string{"user = {:user}"}
	params := dbx.Params{"user": userID}
	if cursor != nil {
		conditions = append(conditions, "(created < {:createdAt} || (created = {:createdAt} && id < {:id}))")
		params["createdAt"] = cursor.CreatedAt
		params["id"] = cursor.ID
	}
	appendStringFieldConditions(&conditions, params, "category", "category", query.Categories)
	appendStringFieldConditions(&conditions, params, "billingCycle", "billingCycle", query.BillingCycles)
	appendStringFieldConditions(&conditions, params, "currency", "currency", query.Currencies)
	appendPaymentMethodConditions(&conditions, params, query.PaymentMethods)
	appendRenewalCondition(&conditions, query.Renewal)
	if query.NextBillingFrom != "" {
		conditions = append(conditions, "nextBillingDate >= {:nextBillingFrom}")
		params["nextBillingFrom"] = query.NextBillingFrom
	}
	if query.NextBillingTo != "" {
		conditions = append(conditions, "nextBillingDate <= {:nextBillingTo}")
		params["nextBillingTo"] = query.NextBillingTo
	}
	if query.Pinned != nil {
		conditions = append(conditions, boolFieldCondition("pinned", *query.Pinned))
	}
	if query.PublicHidden != nil {
		conditions = append(conditions, boolFieldCondition("publicHidden", *query.PublicHidden))
	}
	appendReminderModeCondition(&conditions, query.ReminderMode)
	if query.RepeatReminder != nil {
		conditions = append(conditions, boolFieldCondition("repeatReminderEnabled", *query.RepeatReminder))
	}
	return strings.Join(conditions, " && "), params
}

func appendStringFieldConditions(conditions *[]string, params dbx.Params, field string, prefix string, values []string) {
	if len(values) == 0 {
		return
	}
	orParts := make([]string, 0, len(values))
	for index, value := range values {
		key := prefix + strconv.Itoa(index)
		orParts = append(orParts, field+" = {:"+key+"}")
		params[key] = value
	}
	*conditions = append(*conditions, "("+strings.Join(orParts, " || ")+")")
}

func appendPaymentMethodConditions(conditions *[]string, params dbx.Params, values []string) {
	if len(values) == 0 {
		return
	}
	orParts := make([]string, 0, len(values))
	for index, value := range values {
		if value == subscriptionPaymentMethodNoneValue {
			orParts = append(orParts, "paymentMethod = ''")
			continue
		}
		key := "paymentMethod" + strconv.Itoa(index)
		orParts = append(orParts, "paymentMethod = {:"+key+"}")
		params[key] = value
	}
	*conditions = append(*conditions, "("+strings.Join(orParts, " || ")+")")
}

func appendRenewalCondition(conditions *[]string, renewal string) {
	switch renewal {
	case "auto":
		*conditions = append(*conditions, "billingCycle != 'one-time' && autoRenew = true")
	case "manual":
		*conditions = append(*conditions, "billingCycle != 'one-time' && autoRenew = false")
	case "one-time":
		*conditions = append(*conditions, "billingCycle = 'one-time'")
	}
}

func appendReminderModeCondition(conditions *[]string, mode string) {
	switch mode {
	case "disabled":
		*conditions = append(*conditions, "reminderDays = -2")
	case "inherit":
		*conditions = append(*conditions, "reminderDays = -1")
	case "custom":
		*conditions = append(*conditions, "reminderDays >= 0")
	}
}

func boolFieldCondition(field string, value bool) string {
	if value {
		return field + " = true"
	}
	return field + " = false"
}

func subscriptionRecordMatchesPostFilters(record *core.Record, query subscriptionListQuery, today string) bool {
	if query.Status != "" && effectiveSubscriptionStatusFromRecord(record, today) != query.Status {
		return false
	}
	tags := subscriptionRecordStringSlice(record, "tags")
	if len(query.Tags) > 0 && !subscriptionTagsMatch(tags, query.Tags) {
		return false
	}
	if query.Search != "" && !subscriptionSearchMatches(record, tags, query.Search) {
		return false
	}
	return true
}

func effectiveSubscriptionStatusFromRecord(record *core.Record, today string) string {
	status := record.GetString("status")
	if status == "expired" {
		return "expired"
	}
	if record.GetString("billingCycle") == "one-time" && record.GetInt("oneTimeTermCount") <= 0 {
		return status
	}
	// 列表筛选沿用公开页的有效状态口径：老数据只在查询投影中过期，不回写用户记录。
	if (status == "active" || status == "trial") && isValidDateOnly(record.GetString("nextBillingDate")) && record.GetString("nextBillingDate") < today {
		return "expired"
	}
	return status
}

func subscriptionTagsMatch(tags []string, selected []string) bool {
	byValue := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		byValue[tag] = struct{}{}
	}
	for _, value := range selected {
		if _, ok := byValue[value]; ok {
			return true
		}
	}
	return false
}

func subscriptionSearchMatches(record *core.Record, tags []string, search string) bool {
	query := strings.ToLower(strings.TrimSpace(search))
	if query == "" {
		return true
	}
	for _, value := range []string{
		record.GetString("name"),
		record.GetString("website"),
		record.GetString("notes"),
	} {
		if strings.Contains(strings.ToLower(value), query) {
			return true
		}
	}
	for _, tag := range tags {
		if strings.Contains(strings.ToLower(tag), query) {
			return true
		}
	}
	return false
}

func subscriptionRecordStringSlice(record *core.Record, name string) []string {
	value := jsonValueForResponse(record.Get(name), []string{})
	switch typed := value.(type) {
	case []string:
		return typed
	case []interface{}:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	default:
		return []string{}
	}
}

func (query subscriptionListQuery) hasFilters() bool {
	return query.Search != "" ||
		len(query.Categories) > 0 ||
		len(query.Tags) > 0 ||
		len(query.BillingCycles) > 0 ||
		len(query.PaymentMethods) > 0 ||
		len(query.Currencies) > 0 ||
		query.Status != "" ||
		query.Renewal != "" ||
		query.NextBillingFrom != "" ||
		query.NextBillingTo != "" ||
		query.Pinned != nil ||
		query.PublicHidden != nil ||
		query.ReminderMode != "" ||
		query.RepeatReminder != nil
}

func parseSubscriptionListStrings(values []string, maxItems int, maxLength int, validate func(string) bool) ([]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	if len(values) > maxItems {
		return nil, errors.New("too many query values")
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" || len(value) > maxLength {
			return nil, errors.New("invalid query value")
		}
		if validate != nil && !validate(value) {
			return nil, errors.New("invalid query value")
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out, nil
}

func parseSubscriptionListSingle(values url.Values, name string, maxLength int, validate func(string) bool) (string, error) {
	rawValues := values[name]
	if len(rawValues) == 0 {
		return "", nil
	}
	if len(rawValues) > 1 {
		return "", errors.New("duplicate query value")
	}
	value := strings.TrimSpace(rawValues[0])
	if value == "" || len(value) > maxLength {
		return "", errors.New("invalid query value")
	}
	if validate != nil && !validate(value) {
		return "", errors.New("invalid query value")
	}
	return value, nil
}

func parseSubscriptionListBool(values url.Values, name string) (*bool, error) {
	rawValues := values[name]
	if len(rawValues) == 0 {
		return nil, nil
	}
	if len(rawValues) > 1 {
		return nil, errors.New("duplicate boolean query value")
	}
	var parsed bool
	switch strings.TrimSpace(rawValues[0]) {
	case "true", "1":
		parsed = true
	case "false", "0":
		parsed = false
	default:
		return nil, errors.New("invalid boolean query value")
	}
	return &parsed, nil
}

func isValidSubscriptionListPaymentMethod(value string) bool {
	return value == subscriptionPaymentMethodNoneValue || (strings.TrimSpace(value) == value && value != "")
}

func isSubscriptionListCurrency(value string) bool {
	if len(value) != 3 {
		return false
	}
	for _, char := range value {
		if char < 'A' || char > 'Z' {
			return false
		}
	}
	return true
}

func isSubscriptionListRenewal(value string) bool {
	switch value {
	case "auto", "manual", "one-time":
		return true
	default:
		return false
	}
}

func isSubscriptionListReminderMode(value string) bool {
	switch value {
	case "disabled", "inherit", "custom":
		return true
	default:
		return false
	}
}
