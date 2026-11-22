package graph

import (
	"reflect"
	"testing"
)

func TestTopicsOf(t *testing.T) {
	cases := []struct {
		text string
		want []string
	}{
		{"Heat acclimation: WBGT above 27 raises heart rate; drink and take gels", []string{"heat", "fueling"}},
		{"Plantar and tibia pain after leg day with squats", []string{"injury", "strength"}},
		{"Race plan: opening pace cap and go/no-go at the cut-off for the marathon", []string{"pacing", "race"}},
		{"nothing relevant here", []string{}},
	}
	for _, c := range cases {
		got := topicsOf(c.text)
		if len(got) == 0 && len(c.want) == 0 {
			continue
		}
		for _, w := range c.want {
			found := false
			for _, g := range got {
				if g == w {
					found = true
				}
			}
			if !found {
				t.Errorf("%q: want topic %q in %v", c.text, w, got)
			}
		}
		if len(got) > 3 {
			t.Errorf("%q: more than 3 topics: %v", c.text, got)
		}
	}
	if a, b := topicsOf("heat heat fuel"), topicsOf("heat heat fuel"); !reflect.DeepEqual(a, b) {
		t.Errorf("not deterministic: %v vs %v", a, b)
	}
	if got := topicsOf("heat heat heat fuel"); got[0] != "heat" {
		t.Errorf("strongest first: %v", got)
	}
}

func TestLowerBody(t *testing.T) {
	for _, n := range []string{"Lower Body A", "Leg day", "Squat + deadlift"} {
		if !lowerBody.MatchString(n) {
			t.Errorf("%q should be lower body", n)
		}
	}
	if lowerBody.MatchString("Upper body push") {
		t.Error("upper body is not lower")
	}
}
