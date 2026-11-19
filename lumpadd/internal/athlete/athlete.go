// Package athlete embeds the athlete baseline and the season plan, copied from src/lib/athlete.js and src/data/plan.json by
// tools/sync_go_data.mjs (src/lib/godata.test.js keeps the copies current). In Phase 5 both move into the athlete / plan schemas.
package athlete

import (
	_ "embed"
	"encoding/json"
)

//go:embed data/athlete.json
var athleteJSON []byte

//go:embed data/plan.json
var planJSON []byte

//go:embed data/plan_meta.json
var planMetaJSON []byte

type Race struct {
	Date string  `json:"date"`
	Name string  `json:"name"`
	Km   float64 `json:"km"`
}
type Baseline struct {
	Sex       string            `json:"sex"`
	Born      string            `json:"born"`
	HeightCm  float64           `json:"height_cm"`
	WeightKg  float64           `json:"weight_kg"`
	LTHR      float64           `json:"lthr"`
	HRMax     float64           `json:"hrmax"`
	RHR       float64           `json:"rhr"`
	TPaceS    float64           `json:"tpace_s"`
	VO2Coros  float64           `json:"vo2max_coros"`
	Src       map[string]string `json:"src"`
	Devices   []string          `json:"devices"`
	Races     []Race            `json:"races"`
	Z2Ceiling float64           `json:"z2_ceiling"`
}
type PlanDay struct {
	Date  string          `json:"date"`
	Week  string          `json:"week"`
	Phase string          `json:"phase"`
	Tags  []string        `json:"tags"`
	Km    float64         `json:"km"`
	Label string          `json:"label"`
	Kind  string          `json:"kind"`
	Note  string          `json:"note"`
	Steps json.RawMessage `json:"steps"`
	Sec   float64         `json:"sec"`
	TL    float64         `json:"tl"`
	Code  string          `json:"code"`
}

// Target and the 20 checkpoints (src/lib/plan.js). Line = VDOT fitness line of a time trial (nil for other kinds).
type Target struct {
	Goal       string  `json:"goal"`
	MP         string  `json:"mp"`
	VdotRace   float64 `json:"vdotRace"`
	VdotNeeded float64 `json:"vdotNeeded"`
	Baseline   float64 `json:"baseline"`
}
type Checkpoint struct {
	ID   int      `json:"id"`
	Date string   `json:"date"`
	Name string   `json:"name"`
	Kind string   `json:"kind"`
	Line *float64 `json:"line"`
	Note string   `json:"note"`
}

var (
	Goal        Target
	Checkpoints []Checkpoint
	Athlete     Baseline
	Plan        []PlanDay
	PlanBy      = map[string]*PlanDay{}
)

func init() {
	if err := json.Unmarshal(athleteJSON, &Athlete); err != nil {
		panic("athlete.json: " + err.Error())
	}
	if err := json.Unmarshal(planJSON, &Plan); err != nil {
		panic("plan.json: " + err.Error())
	}
	var meta struct {
		Target      Target       `json:"target"`
		Checkpoints []Checkpoint `json:"checkpoints"`
	}
	if err := json.Unmarshal(planMetaJSON, &meta); err != nil {
		panic("plan_meta.json: " + err.Error())
	}
	Goal, Checkpoints = meta.Target, meta.Checkpoints
	for i := range Plan {
		PlanBy[Plan[i].Date] = &Plan[i]
	}
}

// Hard session kinds (src/lib/gate.js HARD): readiness caps apply before these.
var Hard = map[string]bool{"quality": true, "tt": true, "long": true, "race": true}

// CheckpointResult: what the athlete logged for a checkpoint (kv lumpad.results[id]).
type CheckpointResult struct {
	Vdot  *float64 `json:"vdot"`
	Ratio *float64 `json:"ratio"`
}

// Tone: green ≥ line − 0.5 VDOT, red ≤ line − 1.5, yellow in between.
func Tone(vdot, line float64) string {
	d := vdot - line
	switch {
	case d >= -0.5:
		return "green"
	case d > -1.5:
		return "yellow"
	}
	return "red"
}

// KillGate: two consecutive red time trials from CP4, or a CP11 ratio below 0.85.
func KillGate(results map[string]CheckpointResult) (fired bool, why string) {
	streak := 0
	for _, c := range Checkpoints {
		r, ok := results[itoa(c.ID)]
		if c.Kind != "tt" || c.ID < 4 || !ok || r.Vdot == nil || c.Line == nil {
			continue
		}
		if Tone(*r.Vdot, *c.Line) == "red" {
			streak++
		} else {
			streak = 0
		}
		if streak >= 2 {
			return true, "Two consecutive red TTs (through CP" + itoa(c.ID) + ")"
		}
	}
	if r, ok := results["11"]; ok && r.Ratio != nil && *r.Ratio < 0.85 {
		return true, "CP11 ratio below 0.85"
	}
	return false, ""
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	s := ""
	for ; i > 0; i /= 10 {
		s = string(rune('0'+i%10)) + s
	}
	return s
}
