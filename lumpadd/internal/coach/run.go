package coach

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/llm"
)

// One coach run: safety pre-check → context → model (provider chain, one repair attempt each) → validation → safety adjustments → memory write-back.
// Port of runCoach in server/intel/coach.js; the one addition is fallback to the next provider when a call fails or an answer stays invalid.

var effortByIntent = map[string]string{"daily_brief": "low", "question": "high", "session_review": "high", "weekly_review": "high", "race_plan": "high"}

type RunInput struct {
	Intent, Question, Date, ActivityID string
}

// Retrieved is what the context builder hands over (Phase 4-e builds it from PostgreSQL).
type Retrieved struct {
	Ctx       Context
	ItemIDs   []int64
	Twin      map[string]any
	TokensEst int
	// details for inspection and comparison (not used by the prompt)
	Items     []CtxItem
	Edges     []CtxEdge
	Telemetry []CtxTelemetry
	Focus     string
}
type Retriever interface {
	Retrieve(ctx context.Context, in RunInput) (Retrieved, error)
}

type RunRow struct {
	Intent, Provider, Effort, Question string
	ContextIDs                         []int64
	ContextTokens                      int
	Request                            Prompt
}

// Store keeps the run log (PostgreSQL coach.run at cutover; in-memory until then).
type Store interface {
	NewRun(ctx context.Context, r RunRow) (int64, error)
	SafetyRun(ctx context.Context, intent, question string, parsed map[string]any) (int64, error)
	FailRun(ctx context.Context, id int64, errMsg, response string, usage json.RawMessage, cost *float64, provider, model string) error
	FinishRun(ctx context.Context, id int64, response string, parsed map[string]any, usage json.RawMessage, cost *float64, provider, model string) error
	// RecentPain: the worst pain site (0–10) of the last n check-ins that logged pain, newest first.
	RecentPain(ctx context.Context, n int) ([]float64, error)
}

type Coach struct {
	Store     Store
	Retriever Retriever
	Router    *llm.Router
	Memory    MemoryStore
	Lang      func() string
	// StrictNumbers: check memory-write numbers against the cited items only (see UnverifiedStrict); off = identical to the Node app.
	StrictNumbers bool
}

type RunResult struct {
	RunID     int64          `json:"runId"`
	OK        bool           `json:"ok"`
	Parsed    map[string]any `json:"parsed,omitempty"`
	Writeback *WBResult      `json:"writeback,omitempty"`
	Model     string         `json:"model,omitempty"`
	Provider  string         `json:"provider,omitempty"`
	CostCNY   *float64       `json:"cost_cny"`
	Safety    bool           `json:"safety,omitempty"`
	Text      string         `json:"text,omitempty"`
	Errors    []string       `json:"errors,omitempty"`
	Attempts  []llm.Attempt  `json:"attempts,omitempty"`
}

func addCost(a *float64, b *float64) *float64 {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	v := *a + *b
	return &v
}

// safetyPre: a reported red-flag symptom (in the question, or severe pain in the last two check-ins) gets a referral and NO model call.
func (c *Coach) safetyPre(ctx context.Context, question string) ([]Flag, error) {
	flags := RedFlagsIn(question)
	pains, err := c.Store.RecentPain(ctx, 2)
	if err != nil {
		return nil, err
	}
	for _, w := range pains {
		flags = append(flags, CheckinFlags(Checkin{Pain: &w})...)
	}
	// Map keyed by id: first position, last value
	pos, out := map[string]int{}, []Flag{}
	for _, f := range flags {
		if i, ok := pos[f.ID]; ok {
			out[i] = f
		} else {
			pos[f.ID] = len(out)
			out = append(out, f)
		}
	}
	return out, nil
}

func validAnswer(j any) (map[string]any, []string) {
	if j == nil {
		return nil, []string{"not valid JSON"}
	}
	Normalize(j)
	errs := Validate(j, OutputSchema, "$")
	m, _ := j.(map[string]any)
	return m, errs
}

func (c *Coach) Run(ctx context.Context, in RunInput) (RunResult, error) {
	if in.Intent == "" {
		in.Intent = "daily_brief"
	}
	red, err := c.safetyPre(ctx, in.Question)
	if err != nil {
		return RunResult{}, err
	}
	if len(red) > 0 {
		parsed := ReferralFor(red)
		id, err := c.Store.SafetyRun(ctx, in.Intent, in.Question, parsed)
		if err != nil {
			return RunResult{}, err
		}
		ids := make([]any, len(red))
		for i, f := range red {
			ids[i] = f.ID
		}
		_ = c.Memory.Audit(ctx, "safety:referral", nil, map[string]any{"ids": ids}, id)
		zero := 0.0
		return RunResult{RunID: id, OK: true, Parsed: parsed, Model: "safety-rules", Provider: "safety", CostCNY: &zero, Safety: true}, nil
	}

	ret, err := c.Retriever.Retrieve(ctx, in)
	if err != nil {
		return RunResult{}, err
	}
	task, ok := StableData.Tasks[in.Intent]
	if !ok {
		task = StableData.Tasks["question"]
	}
	lang := "en"
	if c.Lang != nil {
		lang = c.Lang()
	}
	prompt := RenderPrompt(ret.Ctx, task, lang)
	chain := c.Router.Chain(in.Intent)
	if len(chain) == 0 {
		return RunResult{}, errors.New("no provider configured for " + in.Intent)
	}
	effort := effortByIntent[in.Intent]
	runID, err := c.Store.NewRun(ctx, RunRow{Intent: in.Intent, Provider: chain[0], Effort: effort, Question: in.Question, ContextIDs: ret.ItemIDs, ContextTokens: ret.TokensEst, Request: prompt})
	if err != nil {
		return RunResult{}, err
	}
	fail := func(msg string, cost *float64, text string, usage json.RawMessage, prov, model string) {
		_ = c.Store.FailRun(ctx, runID, jsSliceU16(msg, 0, 300), text, usage, cost, prov, model)
	}

	var (
		cost     *float64
		attempts []llm.Attempt
		answer   map[string]any
		final    llm.Response
		lastBad  struct {
			errs []string
			resp llm.Response
		}
		errMsgs []string
	)
	for _, name := range chain {
		resp, att, err := c.Router.CompleteOn(ctx, name, in.Intent, llm.Request{System: prompt.System, User: prompt.User, Effort: effort}, nil, runID)
		attempts = append(attempts, att)
		if err != nil {
			var eb *llm.ErrBudget
			if errors.As(err, &eb) {
				fail(err.Error(), cost, "", nil, name, "")
				return RunResult{RunID: runID, Attempts: attempts, CostCNY: cost}, err
			}
			errMsgs = append(errMsgs, name+": "+err.Error())
			continue
		}
		cost = addCost(cost, resp.CostCNY)
		m, errs := validAnswer(resp.JSON)
		if len(errs) > 0 { // one repair attempt, with the validator's own message
			head := errs
			if len(head) > 6 {
				head = head[:6]
			}
			msgs := []llm.Message{{Role: "system", Content: prompt.System}, {Role: "user", Content: prompt.User}, {Role: "assistant", Content: jsSliceU16(resp.Text, 0, 4000)},
				{Role: "user", Content: "Your reply did not match the required JSON shape: " + strings.Join(head, "; ") + ". Reply again with ONE corrected JSON object only."}}
			r2, att2, err2 := c.Router.CompleteOn(ctx, name, in.Intent, llm.Request{Messages: msgs, Effort: "low"}, nil, runID)
			attempts = append(attempts, att2)
			if err2 == nil {
				cost = addCost(cost, r2.CostCNY)
				resp = r2
				m, errs = validAnswer(r2.JSON)
			} else {
				errMsgs = append(errMsgs, name+" (repair): "+err2.Error())
			}
		}
		if len(errs) > 0 {
			lastBad.errs, lastBad.resp = errs, resp
			errMsgs = append(errMsgs, name+": invalid answer: "+strings.Join(errs[:min(len(errs), 3)], "; "))
			continue
		}
		answer, final = m, resp
		break
	}
	if answer == nil {
		if lastBad.errs != nil {
			fail("schema after repair: "+strings.Join(lastBad.errs[:min(len(lastBad.errs), 5)], "; ")+" — memory writes dropped", cost, lastBad.resp.Text, lastBad.resp.Usage, lastBad.resp.Provider, lastBad.resp.Model)
			return RunResult{RunID: runID, OK: false, Text: lastBad.resp.Text, Errors: lastBad.errs, Attempts: attempts, CostCNY: cost, Provider: lastBad.resp.Provider, Model: lastBad.resp.Model}, nil
		}
		msg := "all providers failed — " + strings.Join(errMsgs, "; ")
		fail(msg, cost, "", nil, "", "")
		return RunResult{RunID: runID, Attempts: attempts, CostCNY: cost}, errors.New(msg)
	}

	// gate check: while a validated gate is active no hard session may be recommended; diagnosis / clearance wording is flagged
	adjusted, removed := GateCheck(answer, GateFromTwin(ret.Twin))
	dx := DiagnosisWording(adjusted)
	if len(dx) > 0 {
		flags, _ := adjusted["flags"].([]any)
		cp := map[string]any{}
		for k, v := range adjusted {
			cp[k] = v
		}
		cp["flags"] = append(append([]any{}, flags...), map[string]any{"type": "rule", "text": `The coach does not diagnose or clear you to train; treat "` + dx[0] + `" as a question for a clinician.`})
		adjusted = cp
	}
	if len(removed) > 0 || len(dx) > 0 {
		acts := []any{}
		for _, r := range removed {
			acts = append(acts, obj(r)["action"])
		}
		dxa := make([]any, len(dx))
		for i, d := range dx {
			dxa[i] = d
		}
		_ = c.Memory.Audit(ctx, "safety:answer-adjusted", nil, map[string]any{"removed": acts, "diagnosis": dxa}, runID)
	}

	// finish: validate the adjusted answer once more, then write back what the model wants remembered
	if errs := Validate(adjusted, OutputSchema, "$"); len(errs) > 0 {
		fail("schema: "+strings.Join(errs[:min(len(errs), 5)], "; "), cost, final.Text, final.Usage, final.Provider, final.Model)
		return RunResult{RunID: runID, OK: false, Errors: errs, Attempts: attempts, CostCNY: cost, Provider: final.Provider, Model: final.Model}, nil
	}
	ids := ret.ItemIDs
	wb, err := ApplyWritebackOpt(ctx, c.Memory, adjusted, runID, ids, prompt.User+"\n"+prompt.System, final.Provider, c.StrictNumbers)
	if err != nil {
		fail("write-back: "+err.Error(), cost, final.Text, final.Usage, final.Provider, final.Model)
		return RunResult{RunID: runID, Attempts: attempts, CostCNY: cost}, err
	}
	stored := map[string]any{}
	for k, v := range adjusted {
		stored[k] = v
	}
	wbj, _ := json.Marshal(wb)
	var wbAny any
	_ = json.Unmarshal(wbj, &wbAny)
	stored["_writeback"] = wbAny
	if err := c.Store.FinishRun(ctx, runID, final.Text, stored, final.Usage, cost, final.Provider, final.Model); err != nil {
		return RunResult{RunID: runID}, err
	}
	return RunResult{RunID: runID, OK: true, Parsed: adjusted, Writeback: &wb, Model: final.Model, Provider: final.Provider, CostCNY: cost, Attempts: attempts}, nil
}
