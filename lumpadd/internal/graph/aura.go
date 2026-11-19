package graph

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Zero-dependency Neo4j AuraDB HTTPS Query API v2 client (stdlib net/http, CGO_ENABLED=0 safe).
// Connects to https://<host>/db/<database>/query/v2 using Basic Auth derived from NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD.

type Client struct {
	Endpoint string
	AuthHdr  string
	HTTP     *http.Client
}

type QueryResult struct {
	Fields []string `json:"fields"`
	Values [][]any  `json:"values"`
}

type apiReq struct {
	Statement  string         `json:"statement"`
	Parameters map[string]any `json:"parameters,omitempty"`
}

type apiResp struct {
	Data   QueryResult `json:"data"`
	Errors []struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

// QueryURL converts a Neo4j URI (neo4j+s://host, bolt+s://host, or https://host) into the AuraDB Query API v2 URL.
func QueryURL(rawURI, database string) (string, error) {
	rawURI = strings.TrimSpace(rawURI)
	if rawURI == "" {
		return "", errors.New("empty NEO4J_URI")
	}
	if database == "" {
		database = "neo4j"
	}
	// If caller passed a full http(s) query URL already (e.g. in tests), use it directly.
	if strings.HasPrefix(rawURI, "http://") || strings.HasPrefix(rawURI, "https://") {
		u, err := url.Parse(rawURI)
		if err != nil {
			return "", err
		}
		if strings.Contains(u.Path, "/query/v2") {
			return rawURI, nil
		}
		return fmt.Sprintf("%s://%s/db/%s/query/v2", u.Scheme, u.Host, url.PathEscape(database)), nil
	}
	norm := rawURI
	for _, p := range []string{"neo4j+s://", "neo4j+ssc://", "bolt+s://", "bolt+ssc://", "neo4j://", "bolt://"} {
		if strings.HasPrefix(norm, p) {
			norm = "https://" + strings.TrimPrefix(norm, p)
			break
		}
	}
	u, err := url.Parse(norm)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("invalid NEO4J_URI %q", rawURI)
	}
	return fmt.Sprintf("https://%s/db/%s/query/v2", u.Host, url.PathEscape(database)), nil
}

// New creates an AuraDB Query API v2 client.
func New(uri, user, pass, database string) (*Client, error) {
	ep, err := QueryURL(uri, database)
	if err != nil {
		return nil, err
	}
	if user == "" || pass == "" {
		return nil, errors.New("NEO4J_USER and NEO4J_PASSWORD are required")
	}
	tok := base64.StdEncoding.EncodeToString([]byte(user + ":" + pass))
	return &Client{
		Endpoint: ep,
		AuthHdr:  "Basic " + tok,
		HTTP:     &http.Client{Timeout: 20 * time.Second},
	}, nil
}

// NewFromEnv builds a Client when NEO4J_URI is set; returns (nil, nil) when unconfigured so callers fall back cleanly.
func NewFromEnv() (*Client, error) {
	uri := strings.TrimSpace(os.Getenv("NEO4J_URI"))
	if uri == "" {
		return nil, nil
	}
	return New(uri, strings.TrimSpace(os.Getenv("NEO4J_USER")), os.Getenv("NEO4J_PASSWORD"), strings.TrimSpace(os.Getenv("NEO4J_DATABASE")))
}

// Query executes a parameterized Cypher statement against AuraDB Query API v2.
func (c *Client) Query(ctx context.Context, cypher string, params map[string]any) (*QueryResult, error) {
	if c == nil {
		return nil, errors.New("nil graph client")
	}
	body, err := json.Marshal(apiReq{Statement: cypher, Parameters: params})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.AuthHdr)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		if len(msg) > 240 {
			msg = msg[:240]
		}
		return nil, fmt.Errorf("neo4j HTTP %d: %s", resp.StatusCode, msg)
	}
	var out apiResp
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("neo4j decode: %w", err)
	}
	if len(out.Errors) > 0 {
		return nil, fmt.Errorf("neo4j %s: %s", out.Errors[0].Code, out.Errors[0].Message)
	}
	return &out.Data, nil
}

// Ping verifies live connectivity to AuraDB.
func (c *Client) Ping(ctx context.Context) error {
	c2, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	_, err := c.Query(c2, "RETURN 1 AS ok", nil)
	return err
}
