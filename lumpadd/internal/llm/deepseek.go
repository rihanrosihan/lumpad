package llm

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"time"
)

// DeepSeek: model resolution (pinned id, or the newest Flash from /models cached for a day) and spend measured as the drop of the account balance.

type DeepSeek struct {
	*OpenAI
	KV    KV
	Pin   string // DEEPSEEK_MODEL; "" or "auto-flash" = resolve the newest Flash
	KVKey string
}

type balanceMeter struct{ p *OpenAI }

func (b balanceMeter) snap(ctx context.Context) *float64 {
	j, err := b.p.api(ctx, "GET", "/user/balance", nil, 20*time.Second)
	if err != nil {
		return nil
	}
	infos, _ := j["balance_infos"].([]any)
	for _, i := range infos {
		m, _ := i.(map[string]any)
		if m["currency"] == "CNY" {
			s, _ := m["total_balance"].(string)
			if v, err := strconv.ParseFloat(s, 64); err == nil {
				return &v
			}
			return nil
		}
	}
	return nil // no CNY balance
}
func (b balanceMeter) Before(ctx context.Context) *float64 { return b.snap(ctx) }
func (b balanceMeter) After(ctx context.Context) *float64  { return b.snap(ctx) }

func NewDeepSeek(base string, key func() (string, error), pin string, kv KV) *DeepSeek {
	d := &DeepSeek{OpenAI: &OpenAI{ProviderName: "deepseek", Base: base, Key: key, Now: time.Now}, KV: kv, Pin: pin, KVKey: "deepseek_model"}
	d.Models = d.resolve
	d.Meter = balanceMeter{d.OpenAI}
	return d
}

func (d *DeepSeek) resolve(ctx context.Context) (ModelInfo, error) {
	if d.Pin != "" && d.Pin != "auto-flash" {
		return ModelInfo{ID: d.Pin, Name: d.Pin, Pinned: true}, nil
	}
	var cached *ModelInfo
	if raw, ok := d.KV.Get(d.KVKey); ok {
		var m ModelInfo
		if json.Unmarshal(raw, &m) == nil && m.ID != "" {
			cached = &m
		}
	}
	nowMs := float64(d.Now().UnixMilli())
	if cached != nil && nowMs-cached.At < dayMs {
		return *cached, nil
	}
	j, err := d.api(ctx, "GET", "/models", nil, 120*time.Second)
	if err == nil {
		var listed struct {
			Data []listedModel `json:"data"`
		}
		b, _ := json.Marshal(j)
		_ = json.Unmarshal(b, &listed)
		pick := PickFlash(listed.Data)
		if pick == nil {
			err = errors.New("no Flash model listed")
		} else {
			out := ModelInfo{ID: pick.ID, Name: nameOrID(*pick), Context: pick.ContextWindow, At: nowMs, Changed: cached != nil && cached.ID != pick.ID}
			if pick.Effort != nil {
				out.Efforts = pick.Effort.SupportedLevels
			}
			if e := d.KV.Set(d.KVKey, out); e != nil {
				return out, nil
			}
			return out, nil
		}
	}
	if cached != nil {
		c := *cached
		c.Stale = true
		return c, nil
	}
	return ModelInfo{}, err
}

// KeyFromEnv returns a key getter that reads an environment variable at call time (so a restart is not needed after adding a key).
func KeyFromEnv(name string) func() (string, error) {
	return func() (string, error) {
		if k := os.Getenv(name); k != "" {
			return k, nil
		}
		return "", errors.New(name + " not set")
	}
}
