package db

import (
	"strings"
	"testing"
)

func TestMigrationsAreOrderedAndOptionalOnesDeclareTheirExtension(t *testing.T) {
	ms, err := Migrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) < 5 {
		t.Fatalf("expected at least 5 migrations, got %d", len(ms))
	}
	for i := 1; i < len(ms); i++ {
		if ms[i-1].Version >= ms[i].Version {
			t.Fatalf("migrations out of order: %s then %s", ms[i-1].Name, ms[i].Name)
		}
	}
	for _, m := range ms {
		if strings.Contains(m.Name, ".optional.") && m.Optional == "" {
			t.Errorf("%s is optional but declares no extension", m.Name)
		}
		if m.Optional == "" && strings.Contains(m.SQL, "CREATE EXTENSION") {
			t.Errorf("%s creates an extension but is not marked optional", m.Name)
		}
	}
	if ms[3].Optional != "timescaledb" || ms[4].Optional != "vector" {
		t.Errorf("optional extensions: %q %q", ms[3].Optional, ms[4].Optional)
	}
}
