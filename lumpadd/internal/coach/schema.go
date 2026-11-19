// Package coach: the AI layer around the model (redesign Phase 4). This file: answer-shape validation, a port of server/intel/schema.js.
package coach

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf16"
)

//go:embed data/output_schema.json
var outputSchemaJSON []byte

// Schema is the JSON-schema subset the validator understands (type, required, properties, items, enum, maxLength, maxItems, minItems).
// Properties keep their declaration order: error messages come out in that order, as in the JS.
type Schema struct {
	Type       string
	Enum       []any
	MaxLength  *int
	MaxItems   *int
	MinItems   *int
	Items      *Schema
	Required   []string
	Properties []Prop
}
type Prop struct {
	Name   string
	Schema *Schema
}

func (s *Schema) UnmarshalJSON(b []byte) error {
	var raw struct {
		Type      string          `json:"type"`
		Enum      []any           `json:"enum"`
		MaxLength *int            `json:"maxLength"`
		MaxItems  *int            `json:"maxItems"`
		MinItems  *int            `json:"minItems"`
		Items     *Schema         `json:"items"`
		Required  []string        `json:"required"`
		Props     json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	*s = Schema{Type: raw.Type, Enum: raw.Enum, MaxLength: raw.MaxLength, MaxItems: raw.MaxItems, MinItems: raw.MinItems, Items: raw.Items, Required: raw.Required}
	if len(raw.Props) > 0 && string(raw.Props) != "null" {
		dec := json.NewDecoder(bytes.NewReader(raw.Props))
		if _, err := dec.Token(); err != nil { // {
			return err
		}
		for dec.More() {
			k, err := dec.Token()
			if err != nil {
				return err
			}
			var sub Schema
			if err := dec.Decode(&sub); err != nil {
				return err
			}
			s.Properties = append(s.Properties, Prop{k.(string), &sub})
		}
	}
	return nil
}

// OutputSchema is the coach/1 answer contract (embedded copy of server/intel/schema.js, kept current by tools/sync_go_data.mjs).
var OutputSchema = func() *Schema {
	var s Schema
	if err := json.Unmarshal(outputSchemaJSON, &s); err != nil {
		panic("output_schema.json: " + err.Error())
	}
	return &s
}()

// u16len: JS string .length
func u16len(s string) int { return len(utf16.Encode([]rune(s))) }

// jsType: the `t` of the JS validator for a JSON-decoded value
func jsType(v any, want string) string {
	switch x := v.(type) {
	case []any:
		return "array"
	case nil:
		return "null"
	case float64:
		if want == "integer" && x == math.Trunc(x) && !math.IsInf(x, 0) {
			return "integer"
		}
		return "number"
	case string:
		return "string"
	case bool:
		return "boolean"
	}
	return "object"
}

func jsEq(a, b any) bool { // enum membership: strict equality of JSON scalars
	return fmt.Sprintf("%T:%v", a, a) == fmt.Sprintf("%T:%v", b, b)
}

// Validate returns the list of problems (empty = valid), in the same order and wording as the JS validator.
func Validate(v any, s *Schema, path string) []string {
	err := []string{}
	t := jsType(v, s.Type)
	_, isNum := v.(float64)
	isInt := false
	if f, ok := v.(float64); ok {
		isInt = f == math.Trunc(f) && !math.IsInf(f, 0)
	}
	if s.Type != "" && !(s.Type == t || (s.Type == "number" && isNum) || (s.Type == "integer" && isInt)) {
		return []string{fmt.Sprintf("%s: expected %s, got %s", path, s.Type, t)}
	}
	if s.Enum != nil {
		found := false
		for _, e := range s.Enum {
			if jsEq(e, v) {
				found = true
			}
		}
		if !found {
			parts := make([]string, len(s.Enum))
			for i, e := range s.Enum {
				parts[i] = fmt.Sprint(e)
			}
			err = append(err, fmt.Sprintf("%s: must be one of %s", path, strings.Join(parts, "|")))
		}
	}
	if str, ok := v.(string); ok && s.MaxLength != nil && u16len(str) > *s.MaxLength {
		err = append(err, fmt.Sprintf("%s: longer than %d", path, *s.MaxLength))
	}
	if s.Type == "array" {
		arr, _ := v.([]any)
		if s.MaxItems != nil && len(arr) > *s.MaxItems {
			err = append(err, fmt.Sprintf("%s: more than %d items", path, *s.MaxItems))
		}
		if s.MinItems != nil && len(arr) < *s.MinItems {
			err = append(err, fmt.Sprintf("%s: fewer than %d items", path, *s.MinItems))
		}
		if s.Items != nil {
			for i, x := range arr {
				err = append(err, Validate(x, s.Items, fmt.Sprintf("%s[%d]", path, i))...)
			}
		}
	}
	if s.Type == "object" {
		obj, _ := v.(map[string]any)
		for _, k := range s.Required {
			if _, ok := obj[k]; !ok {
				err = append(err, fmt.Sprintf("%s: missing %s", path, k))
			}
		}
		for _, p := range s.Properties {
			if x, ok := obj[p.Name]; ok {
				err = append(err, Validate(x, p.Schema, path+"."+p.Name)...)
			}
		}
	}
	return err
}

var flagTypes = map[string]bool{"gate": true, "injury": true, "load": true, "heat": true, "data_gap": true, "rule": true, "other": true}

// Normalize: cosmetic only (unknown flag category labels become "other"); anything that affects advice or memory stays strictly validated.
// It edits the answer in place, as the JS does.
func Normalize(j any) any {
	if m, ok := j.(map[string]any); ok {
		if flags, ok := m["flags"].([]any); ok {
			for _, f := range flags {
				if fm, ok := f.(map[string]any); ok {
					if t, _ := fm["type"].(string); !flagTypes[t] {
						fm["type"] = "other"
					}
				}
			}
		}
	}
	return j
}
