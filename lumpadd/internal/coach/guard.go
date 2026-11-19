package coach

import "fmt"

// Spend guard decision: port of guardDecision in server/intel/llm.js (spend and the largest single call so far are inputs; provider-agnostic, in CNY as the cap is).
type Guard struct {
	OK     bool    `json:"ok"`
	Level  string  `json:"level"`
	Spend  float64 `json:"spend"`
	Cap    float64 `json:"cap"`
	Reason string  `json:"reason,omitempty"`
}

func GuardDecision(intent string, spend, cap, maxCall float64) Guard {
	if spend >= cap {
		return Guard{false, "paused", spend, cap, fmt.Sprintf("monthly cap ¥%s reached (spent ¥%s) — paused until next month", JSNum(cap), JSNum(spend))}
	}
	if cap-spend < maxCall {
		return Guard{false, "paused", spend, cap, fmt.Sprintf("remaining ¥%.2f is below the largest call this month (¥%.2f)", cap-spend, maxCall)}
	}
	limited := spend >= 0.8*cap
	if limited && intent != "daily_brief" && intent != "question" {
		return Guard{false, "limited", spend, cap, fmt.Sprintf("80 %% of the ¥%s cap used — only the daily brief and asked questions run", JSNum(cap))}
	}
	if limited {
		return Guard{true, "limited", spend, cap, ""}
	}
	return Guard{true, "ok", spend, cap, ""}
}
