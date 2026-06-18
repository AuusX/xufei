package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"strings"
)

type costSharingPayload struct {
	Enabled       bool                `json:"enabled"`
	PayerMemberID string              `json:"payerMemberId"`
	SelfMemberID  string              `json:"selfMemberId"`
	SplitMode     string              `json:"splitMode"`
	Members       []costSharingMember `json:"members"`
}

type costSharingMember struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Note         string   `json:"note,omitempty"`
	Currency     string   `json:"currency,omitempty"`
	Included     bool     `json:"included"`
	CustomAmount *float64 `json:"customAmount,omitempty"`
}

// normalizeCostSharing 是 Docker 持久层的 costSharing 契约门；API、SDK 和 Admin UI 写入都必须收敛到 shared wire shape。
func normalizeCostSharing(value interface{}, price float64, baseCurrency string) (interface{}, error) {
	data, err := jsonBytesFromValue(value)
	if err != nil || len(bytes.TrimSpace(data)) == 0 || string(bytes.TrimSpace(data)) == "{}" {
		return emptyJSONPayload{}, err
	}
	var payload costSharingPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, errors.New("COST_SHARING_JSON_INVALID")
	}
	if !payload.Enabled {
		return emptyJSONPayload{}, nil
	}
	payload.PayerMemberID = strings.TrimSpace(payload.PayerMemberID)
	payload.SelfMemberID = strings.TrimSpace(payload.SelfMemberID)
	if payload.SplitMode != "equal" && payload.SplitMode != "custom" {
		return nil, errors.New("COST_SHARING_SPLIT_MODE_INVALID")
	}
	if payload.PayerMemberID == "" || payload.SelfMemberID == "" || len(payload.Members) == 0 || len(payload.Members) > 20 {
		return nil, errors.New("COST_SHARING_MEMBERS_INVALID")
	}
	ids := map[string]struct{}{}
	includedCount := 0
	customTotal := 0.0
	canValidateCustomTotal := true
	for index := range payload.Members {
		member := &payload.Members[index]
		member.ID = strings.TrimSpace(member.ID)
		member.Name = strings.TrimSpace(member.Name)
		member.Note = strings.TrimSpace(member.Note)
		member.Currency = strings.TrimSpace(member.Currency)
		if member.ID == "" || member.Name == "" || len([]rune(member.ID)) > 80 || len([]rune(member.Name)) > 80 {
			return nil, errors.New("COST_SHARING_MEMBER_INVALID")
		}
		if len([]rune(member.Note)) > 500 {
			return nil, errors.New("COST_SHARING_MEMBER_NOTE_TOO_LONG")
		}
		if member.Currency != "" && !currencyCodeRe.MatchString(member.Currency) {
			return nil, errors.New("COST_SHARING_MEMBER_CURRENCY_INVALID")
		}
		if member.Currency != "" && member.Currency != baseCurrency {
			canValidateCustomTotal = false
		}
		if _, exists := ids[member.ID]; exists {
			return nil, errors.New("COST_SHARING_MEMBER_DUPLICATE")
		}
		ids[member.ID] = struct{}{}
		if !member.Included {
			continue
		}
		includedCount++
		if payload.SplitMode == "custom" {
			if member.CustomAmount == nil || *member.CustomAmount < 0 || *member.CustomAmount > maxSubscriptionPrice {
				return nil, errors.New("COST_SHARING_CUSTOM_AMOUNT_INVALID")
			}
			customTotal += *member.CustomAmount
		}
	}
	if includedCount == 0 {
		return nil, errors.New("COST_SHARING_INCLUDED_REQUIRED")
	}
	if _, ok := ids[payload.PayerMemberID]; !ok {
		return nil, errors.New("COST_SHARING_PAYER_INVALID")
	}
	if _, ok := ids[payload.SelfMemberID]; !ok {
		return nil, errors.New("COST_SHARING_SELF_INVALID")
	}
	// Go hook 没有用户汇率上下文；含异币种成员时只做结构校验，严格总额校验交给有转换器的前端和同币种写入。
	if payload.SplitMode == "custom" && canValidateCustomTotal && math.Abs(roundMoney(customTotal)-roundMoney(price)) > 0.01 {
		return nil, errors.New("COST_SHARING_CUSTOM_TOTAL_INVALID")
	}
	return payload, nil
}

func roundMoney(value float64) float64 {
	return math.Round((value+1e-9)*100) / 100
}
