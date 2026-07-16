package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ClickHouse struct {
	cfg    Config
	client *http.Client
}

func NewClickHouse(cfg Config) *ClickHouse {
	return &ClickHouse{
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// Query executes a single fixed SQL statement against ClickHouse's HTTP
// interface. Values are never interpolated into sql — they're always bound
// through ClickHouse's native `{name:Type}` query parameters, passed here as
// `param_<name>` query-string arguments. Caller must close the returned
// response body.
func (c *ClickHouse) Query(ctx context.Context, sql string, params map[string]string) (*http.Response, error) {
	u, err := url.Parse(c.cfg.ClickHouseURL)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("database", c.cfg.ClickHouseDatabase)
	for name, value := range params {
		q.Set("param_"+name, value)
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), strings.NewReader(sql))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.cfg.ClickHouseUser, c.cfg.ClickHousePassword)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("clickhouse returned %d: %s", resp.StatusCode, string(body))
	}
	return resp, nil
}
