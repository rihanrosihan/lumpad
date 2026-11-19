package llm

import "math"

// Prices: what a provider charges per million tokens (set in the config; there is no built-in table because prices change and a wrong default would
// silently misreport spend). Cost is converted to CNY, the unit of the monthly cap, with FXToCNY (1 for CNY prices).
type Prices struct {
	InputPerM      float64 `json:"input_per_m"`
	OutputPerM     float64 `json:"output_per_m"`
	CacheReadPerM  float64 `json:"cache_read_per_m"`  // prompt tokens served from the provider's cache
	CacheWritePerM float64 `json:"cache_write_per_m"` // tokens written to the cache (Anthropic bills a premium for them)
	FXToCNY        float64 `json:"fx_to_cny"`
}

// Known: the price table is filled in (otherwise the cost of a call is unknown, not zero).
func (p *Prices) Known() bool { return p != nil && (p.InputPerM > 0 || p.OutputPerM > 0) }

// Cost in CNY, rounded to 4 decimals like the balance-drop cost. Cached prompt tokens are billed at the cache-read price, not the input price.
func (p *Prices) Cost(u TokenUsage, cacheWrite int) *float64 {
	if !p.Known() {
		return nil
	}
	fx := p.FXToCNY
	if fx == 0 {
		fx = 1
	}
	plain := math.Max(0, float64(u.Prompt-u.CachedPrompt-cacheWrite))
	v := (plain*p.InputPerM + float64(u.CachedPrompt)*p.CacheReadPerM + float64(cacheWrite)*p.CacheWritePerM + float64(u.Completion)*p.OutputPerM) / 1e6 * fx
	v = math.Round(v*1e4) / 1e4
	return &v
}
