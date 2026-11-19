package llm

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// Configuration: which providers exist and which chain serves each intent. The file lives in the data directory (llm.json, outside git, since it
// names the keys' environment variables and holds prices); without one the built-in default is DeepSeek only, as today.

//go:embed data/llm.default.json
var defaultConfigJSON []byte

type ProviderCfg struct {
	Kind           string         `json:"kind"` // deepseek | anthropic | openai
	Base           string         `json:"base"`
	KeyEnv         string         `json:"key_env"`
	Model          string         `json:"model"`
	ModelEnv       string         `json:"model_env"` // deepseek: environment variable that pins the model ("auto-flash" or empty = newest Flash)
	Efforts        []string       `json:"efforts"`
	Prices         *Prices        `json:"prices"`
	Thinking       map[string]int `json:"thinking"` // anthropic: effort → extended-thinking budget tokens
	TokenParam     string         `json:"token_param"`
	NoJSONMode     bool           `json:"no_json_mode"`
	MaxCallsPerDay int            `json:"max_calls_per_day"`
}
type Config struct {
	Providers map[string]ProviderCfg `json:"providers"`
	Routes    map[string][]string    `json:"routes"`
	CapCNY    float64                `json:"monthly_cap_cny"` // 0 = DEEPSEEK_MONTHLY_CAP_CNY or 15
}

func LoadConfig(path string) (Config, error) {
	raw := defaultConfigJSON
	if path != "" {
		if b, err := os.ReadFile(path); err == nil {
			raw = b
		} else if !os.IsNotExist(err) {
			return Config{}, err
		}
	}
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return Config{}, fmt.Errorf("llm config: %w", err)
	}
	return c, c.Validate()
}

func (c Config) Validate() error {
	names := make([]string, 0, len(c.Providers))
	for n, p := range c.Providers {
		names = append(names, n)
		switch p.Kind {
		case "deepseek", "anthropic", "openai":
		default:
			return fmt.Errorf("provider %q: unknown kind %q", n, p.Kind)
		}
		if p.Base == "" || p.KeyEnv == "" {
			return fmt.Errorf("provider %q: base and key_env are required", n)
		}
		if p.Kind != "deepseek" && p.Model == "" {
			return fmt.Errorf("provider %q: model is required", n)
		}
	}
	sort.Strings(names)
	for intent, chain := range c.Routes {
		for _, n := range chain {
			if _, ok := c.Providers[n]; !ok {
				return fmt.Errorf("route %q names unknown provider %q (have %v)", intent, n, names)
			}
		}
	}
	if len(c.Routes["default"]) == 0 {
		return fmt.Errorf("routes.default is required")
	}
	return nil
}

// Build creates the providers and the router. getenv is os.Getenv in production.
func Build(c Config, kv KV, ledger Ledger, guard GuardFn, getenv func(string) string) (*Router, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	key := func(env string) func() (string, error) {
		return func() (string, error) {
			if k := getenv(env); k != "" {
				return k, nil
			}
			return "", fmt.Errorf("%s not set", env)
		}
	}
	r := &Router{Providers: map[string]Provider{}, Routes: c.Routes, Ledger: ledger, Guard: guard, CapCNY: c.CapCNY, MaxCallsPerDay: map[string]int{}}
	if r.CapCNY == 0 {
		r.CapCNY = 15
		if v := getenv("DEEPSEEK_MONTHLY_CAP_CNY"); v != "" {
			var f float64
			if _, err := fmt.Sscan(v, &f); err == nil && f > 0 {
				r.CapCNY = f
			}
		}
	}
	for name, p := range c.Providers {
		switch p.Kind {
		case "deepseek":
			pin := p.Model
			if p.ModelEnv != "" {
				pin = getenv(p.ModelEnv)
			}
			r.Providers[name] = NewDeepSeek(p.Base, key(p.KeyEnv), pin, kv)
		case "anthropic":
			r.Providers[name] = &Anthropic{ProviderName: name, Base: p.Base, Key: key(p.KeyEnv), Model: p.Model, Thinking: p.Thinking, Prices: p.Prices}
		case "openai":
			o := NewOpenAICompat(name, p.Base, key(p.KeyEnv), p.Model, p.Efforts, p.Prices)
			o.TokenParam, o.NoJSONMode = p.TokenParam, p.NoJSONMode
			r.Providers[name] = o
		}
		if p.MaxCallsPerDay > 0 {
			r.MaxCallsPerDay[name] = p.MaxCallsPerDay
		} else if p.Kind != "deepseek" && !p.Prices.Known() {
			r.MaxCallsPerDay[name] = 20 // cost unknown (no price table): cap the calls instead
		}
	}
	return r, nil
}
