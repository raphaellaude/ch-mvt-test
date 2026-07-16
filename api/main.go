// Command api is a minimal, dependency-free proxy in front of ClickHouse:
// it hides DB credentials from the browser and forwards each request to one
// of three fixed, parameterized SQL queries (see queries.go), streaming
// ClickHouse's response straight back to the client.
package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
)

func main() {
	cfg := loadConfig()
	ch := NewClickHouse(cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /tile/{z}/{x}/{y}", handleTile(ch))
	mux.HandleFunc("GET /aggregates", handleAggregates(ch))
	mux.HandleFunc("GET /top-parcels", handleTopParcels(ch))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	handler := withCORS(cfg.AllowedOrigin, withLogging(mux))

	addr := ":" + cfg.Port
	log.Printf("api listening on %s (clickhouse: %s)", addr, cfg.ClickHouseURL)
	log.Fatal(http.ListenAndServe(addr, handler))
}

// handleTile serves GET /tile/{z}/{x}/{y} as a Mapbox Vector Tile.
func handleTile(ch *ClickHouse) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		z, zErr := strconv.Atoi(r.PathValue("z"))
		x, xErr := strconv.Atoi(r.PathValue("x"))
		y, yErr := strconv.Atoi(r.PathValue("y"))
		if zErr != nil || xErr != nil || yErr != nil || z < 0 || z > 24 || x < 0 || y < 0 {
			http.Error(w, "invalid tile coordinates", http.StatusBadRequest)
			return
		}
		maxIndex := 1 << z
		if x >= maxIndex || y >= maxIndex {
			http.Error(w, "tile coordinates out of range for zoom", http.StatusBadRequest)
			return
		}

		params := map[string]string{
			"z": strconv.Itoa(z),
			"x": strconv.Itoa(x),
			"y": strconv.Itoa(y),
		}

		resp, err := ch.Query(r.Context(), tileQuery, params)
		if err != nil {
			log.Printf("tile query failed: %v", err)
			http.Error(w, "failed to generate tile", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		io.Copy(w, resp.Body)
	}
}

// handleAggregates serves GET /aggregates?minLon=&minLat=&maxLon=&maxLat=
func handleAggregates(ch *ClickHouse) http.HandlerFunc {
	return handleBBoxQuery(ch, aggregatesQuery)
}

// handleTopParcels serves GET /top-parcels?minLon=&minLat=&maxLon=&maxLat=
func handleTopParcels(ch *ClickHouse) http.HandlerFunc {
	return handleBBoxQuery(ch, topParcelsQuery)
}

func handleBBoxQuery(ch *ClickHouse, sql string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		params, err := parseBBoxParams(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		resp, err := ch.Query(r.Context(), sql, params)
		if err != nil {
			log.Printf("query failed: %v", err)
			http.Error(w, "query failed", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/json")
		io.Copy(w, resp.Body)
	}
}

func parseBBoxParams(r *http.Request) (map[string]string, error) {
	params := map[string]string{}
	for _, name := range []string{"minLon", "minLat", "maxLon", "maxLat"} {
		raw := r.URL.Query().Get(name)
		if raw == "" {
			return nil, fmt.Errorf("missing required query param %q", name)
		}
		if _, err := strconv.ParseFloat(raw, 64); err != nil {
			return nil, fmt.Errorf("invalid float for %q", name)
		}
		params[name] = raw
	}
	return params, nil
}

func withCORS(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.RequestURI())
		next.ServeHTTP(w, r)
	})
}
