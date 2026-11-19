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

type Race struct {
	Date string  `json:"date"`
	Name string  `json:"name"`
	Km   float64 `json:"km"`
}
type Baseline struct {
	Sex       string  `json:"sex"`
	Born      string  `json:"born"`
	HeightCm  float64 `json:"height_cm"`
	WeightKg  float64 `json:"weight_kg"`
	LTHR      float64 `json:"lthr"`
	HRMax     float64 `json:"hrmax"`
	RHR       float64 `json:"rhr"`
	TPaceS    float64 `json:"tpace_s"`
	VO2Coros  float64 `json:"vo2max_coros"`
	Races     []Race  `json:"races"`
	Z2Ceiling float64 `json:"z2_ceiling"`
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

var (
	Athlete Baseline
	Plan    []PlanDay
	PlanBy  = map[string]*PlanDay{}
)

func init() {
	if err := json.Unmarshal(athleteJSON, &Athlete); err != nil {
		panic("athlete.json: " + err.Error())
	}
	if err := json.Unmarshal(planJSON, &Plan); err != nil {
		panic("plan.json: " + err.Error())
	}
	for i := range Plan {
		PlanBy[Plan[i].Date] = &Plan[i]
	}
}
