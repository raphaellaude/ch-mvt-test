package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	ClickHouseURL      string // e.g. http://localhost:8123
	ClickHouseUser     string
	ClickHousePassword string
	ClickHouseDatabase string
	Port               string
	AllowedOrigin      string
}

// loadEnvFile does a best-effort, dependency-free ".env" load: it only sets
// variables that aren't already present in the environment, so real env
// vars (e.g. in prod) always win. Missing file is not an error.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func loadConfig() Config {
	loadEnvFile(".env")

	scheme := "http"
	if getEnv("CLICKHOUSE_SECURE", "false") == "true" {
		scheme = "https"
	}
	host := getEnv("CLICKHOUSE_HOST", "localhost")
	port := getEnv("CLICKHOUSE_PORT", "8123")

	return Config{
		ClickHouseURL:      fmt.Sprintf("%s://%s:%s", scheme, host, port),
		ClickHouseUser:     getEnv("CLICKHOUSE_USER", "default"),
		ClickHousePassword: getEnv("CLICKHOUSE_PASSWORD", ""),
		ClickHouseDatabase: getEnv("CLICKHOUSE_DATABASE", "default"),
		Port:               getEnv("PORT", "8080"),
		AllowedOrigin:      getEnv("ALLOWED_ORIGIN", "http://localhost:5173"),
	}
}
