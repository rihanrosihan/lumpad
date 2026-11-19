package coros

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"testing"
)

func norm(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("marshal error: %v", err)
	}
	var o any
	_ = json.Unmarshal(b, &o)
	return o
}

func parse(tool, text string) any {
	switch tool {
	case "queryDailyHealthData":
		return ParseDailyHealth(text)
	case "querySleepHrv":
		return ParseSleepHrv(text)
	case "queryRestingHeartRate":
		return ParseResting(text)
	case "querySportRecords":
		return ParseSportRecords(text)
	case "queryActivityLapData":
		if p := ParseLaps(text); p != nil {
			return p
		}
		return nil
	case "queryTrainingLoadAssessment":
		return ParseTrainingLoad(text)
	case "queryRecoveryStatus":
		return ParseRecovery(text)
	case "queryDevices":
		return ParseDevices(text)
	case "querySleepOverview":
		return ParseSleepOverview(text)
	case "getActivityDetail":
		return ParseActivityDetail(text)
	case "queryFitnessAssessmentOverview":
		return ParseFitness(text)
	}
	return "unknown tool"
}

// Replays every archived COROS response through the Go parsers and compares with the Node parsers' output.
//   node tools/export_coros_parse.mjs   (with DATA_DIR) → COROS_PARSE_FIXTURE=../tools/golden/out/coros_parse.json go test ./internal/coros
func TestReplayArchivedResponses(t *testing.T) {
	path := os.Getenv("COROS_PARSE_FIXTURE")
	if path == "" {
		t.Skip("COROS_PARSE_FIXTURE not set")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Tool, Text string
		Out        any
	}
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	bad := map[string]int{}
	for i, c := range cases {
		got := norm(parse(c.Tool, c.Text))
		if !reflect.DeepEqual(got, c.Out) {
			if bad[c.Tool] < 2 {
				gj, _ := json.Marshal(got)
				wj, _ := json.Marshal(c.Out)
				t.Errorf("case %d %s:\n  go %.400s\n  js %.400s", i, c.Tool, gj, wj)
			}
			bad[c.Tool]++
		}
	}
	if len(bad) > 0 {
		t.Errorf("mismatches by tool: %v (of %d responses)", bad, len(cases))
	}
}

func TestParsersSmall(t *testing.T) {
	h := ParseDailyHealth("--- 20261118 ---\nSteps: 12,345 | Stress: Avg 31\nSleep: Total: 7 h 12 min | Deep: 1 h 5 min | Light: 4 h | REM: 58 min | Awake: 9 min\nSleep HR: Avg 55 | Min 49 | Max 70\n--- 20261117 ---\nSteps: 800\n")
	want := []Row{{"date": "2026-11-18", "steps": 12345.0, "stress_avg": 31.0, "sleep_total_min": 432.0, "sleep_deep_min": 65.0, "sleep_light_min": 240.0, "sleep_rem_min": 58.0, "sleep_awake_min": 9.0,
		"sleep_hr_avg": 55.0, "sleep_hr_min": 49.0, "sleep_hr_max": 70.0}, {"date": "2026-11-17", "steps": 800.0}}
	if !reflect.DeepEqual(norm(h), norm(want)) {
		t.Errorf("daily health: %v", h)
	}
	r := ParseSportRecords("Activities:\n1. Morning Run — 2026-11-18 06:01\n   LabelId: 481 SportType: 100\n   Distance: 10.25 km | Duration: 1:02:03 | Average Pace: 6:03 /km | Avg HR: 148\n2. Gym — 2026-11-17\n   LabelId: 482 SportType: 402\n   Duration: 45:00\n")
	if len(r) != 2 || r[0]["distance_m"] != 10250.0 || r[0]["duration_s"] != 3723.0 || r[0]["avg_pace_s_km"] != 363.0 || r[1]["sport"] != "Strength" || r[1]["duration_s"] != 2700.0 {
		t.Errorf("sport records: %v", r)
	}
	l := ParseLaps(`{"lapGroups":[{"type":-1,"laps":[{"avgCadence":172,"avgPower":0,"maxHr":171}]},{"type":2,"laps":[{"distance":100000,"time":365,"avgPace":365,"avgHr":150,"avgCadence":0,"avgStrideLength":82,"strideRatio":75,"groundTime":null}]}]}`)
	lj, _ := json.Marshal(l)
	if string(lj) != `{"cadence":172,"laps":[{"avg_hr":150,"avg_pace_s_km":365,"distance_m":1000,"duration_s":365,"stride_m":0.82,"vratio_pct":7.5}],"max_hr":171}` {
		t.Errorf("laps: %s", lj)
	}
	if ParseLaps("not json") != nil {
		t.Error("unreadable laps should be nil")
	}
	if got := jsSlice("Lari pagi 🏃 di GBK", 12); got != "Lari pagi 🏃" {
		t.Errorf("jsSlice: %q", got)
	}
	if v := ParseTrainingLoad("2026-11-18\n Comment: Optimal\n Short-Term Load: 80\n Long-Term Load: 70\n Load Ratio: 1.14"); len(v) != 1 || math.Abs(v[0]["load_ratio"].(float64)-1.14) > 1e-12 {
		t.Errorf("load: %v", v)
	}
}
