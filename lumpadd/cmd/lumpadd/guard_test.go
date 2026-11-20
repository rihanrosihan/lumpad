package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGuardRequiresHeaderOnWritesAndCapsBodies(t *testing.T) {
	var read int
	h := guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 1<<20)
		n, err := r.Body.Read(b)
		read = n
		if err != nil && err != io.EOF {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(200)
	}))
	do := func(method, hdr, body string) int {
		req := httptest.NewRequest(method, "/api/v2/x", strings.NewReader(body))
		if hdr != "" {
			req.Header.Set("X-Lumpad", hdr)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := do("GET", "", ""); c != 200 {
		t.Errorf("GET without header = %d, want 200", c)
	}
	if c := do("POST", "", "{}"); c != 403 {
		t.Errorf("POST without header = %d, want 403", c)
	}
	if c := do("POST", "0", "{}"); c != 403 {
		t.Errorf("POST with wrong header = %d, want 403", c)
	}
	if c := do("POST", "1", "{}"); c != 200 {
		t.Errorf("POST with header = %d, want 200", c)
	}
	do("POST", "1", strings.Repeat("a", 200<<10))
	if read > 64<<10 {
		t.Errorf("handler read %d bytes, cap is %d", read, 64<<10)
	}
	if got := publicErr(http.ErrAbortHandler); strings.Contains(got, "abort") {
		t.Errorf("publicErr leaks error text: %q", got)
	}
}
