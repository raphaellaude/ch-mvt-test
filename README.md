# ch-mvt-test

A small test of ClickHouse's native Mapbox Vector Tile functions (`MVTEncode`,
`MVTEncodeGeom`, `MVTBoundingBox`), added in the 26.6 release. Loads all
856,694 NYC PLUTO parcels into ClickHouse, serves vector tiles straight out
of it through a thin Go proxy, and renders them in a React/MapLibre app that
also runs live aggregate queries against the current map viewport — the same
ClickHouse table is both the tile server and the analytics engine.

```
docker-compose.yml   local ClickHouse 26.6 (HTTP :8123)
elt/                 Python (uv) — loads the PLUTO FlatGeobuf into ClickHouse
api/                 Go (stdlib only) — /tile, /aggregates, /top-parcels
app/                 React + Vite + MapLibre GL
```

## Why local ClickHouse, not Cloud

The MVT functions ship in ClickHouse 26.6. As of writing, ClickHouse Cloud's
release channels are still on 26.2–26.4 (see
[cloud/release-status](https://clickhouse.com/docs/cloud/release-status)), so
this repo runs ClickHouse locally via Docker, pinned to `clickhouse/clickhouse-server:26.6`.
Both `elt/` and `api/` read their ClickHouse connection info from env vars, so
pointing at Cloud later (once 26.6+ is available there) is a config change,
not a code change.

## Run it

```bash
# 1. ClickHouse
docker compose up -d
curl -s --user 'default:clickhouse' --data-binary \
  "SELECT name FROM system.functions WHERE name ILIKE '%MVT%'" http://localhost:8123
# should list MVTEncode, MVTEncodeGeom, MVTBoundingBox, MVTBoundingBoxMercator

# 2. Load the parcels (~60s for 856k rows; downloads a public ~260MB fgb on first run)
cd elt
cp .env.example .env   # defaults already match the local ClickHouse above
uv run python3 load_pluto.py

# 3. API
cd ../api
cp .env.example .env
go run .                # http://localhost:8090

# 4. App
cd ../app
cp .env.example .env
pnpm install
pnpm dev                 # http://localhost:5173
```

## How it works

- **`elt/load_pluto.py`** streams the source FlatGeobuf in 5k-row batches via
  `pyogrio.raw.read` (no geopandas), converts each geometry directly into the
  nested list structure that matches ClickHouse's native `MultiPolygon` type
  (`Array(Array(Array(Tuple(Float64, Float64))))`) — no WKB/WKT round trip —
  and computes, once per row, a bounding box (since ClickHouse has no spatial
  index yet, viewport/tile queries prune on this instead) and a planar area
  in square feet (`area_sqft`, reprojected into NY State Plane feet — the
  export has no PLUTO `LotArea`/`BldgArea` attribute, so this stands in for
  it, computed once at load time rather than from geometry on every query).
  `pluto_parcels` is `ORDER BY (min_lon, min_lat)` with `minmax` skip indexes
  on `max_lon`/`max_lat`, so every viewport/tile query's four-sided
  bbox-overlap filter can skip most granules.

- **`api/`** has zero third-party dependencies. It doesn't build SQL from
  request input — it holds three fixed query strings (`queries.go`) and binds
  every request value (tile `z/x/y`, viewport bbox) through ClickHouse's
  native HTTP `{name:Type}` parameters. `/tile/{z}/{x}/{y}` calls
  `MVTEncode`/`MVTEncodeGeom`/`MVTBoundingBox` and streams back the raw
  protobuf tile; `/aggregates` and `/top-parcels` ask ClickHouse for
  `FORMAT JSON` and pass the response straight through, so there's no
  server-side JSON re-marshaling. `/aggregates` also returns
  `value_breaks` — the 20th/40th/60th/80th percentiles of assessed value per
  square foot within the current viewport, recomputed by ClickHouse on every
  request.

- **`app/`** renders the tiles with MapLibre GL (no basemap yet, per the
  brief — just the parcels on a solid background), choropleth-colored by
  assessed value per square foot on a 5-class YlGn scale. The color breaks
  and the legend are driven by `value_breaks` from `/aggregates`, so they're
  recomputed for whatever's actually in the current viewport instead of a
  fixed global scale — panning from a low-rise neighborhood to a dense
  commercial district visibly redraws both. On every `moveend` (debounced)
  it fetches `/aggregates` and `/top-parcels` for the current viewport to
  populate the stats panel and the ranked parcel table.

## Later: pointing at ClickHouse Cloud

Update `CLICKHOUSE_HOST`/`PORT`/`SECURE`/`USER`/`PASSWORD` in `elt/.env` and
`api/.env` to the Cloud service's HTTPS endpoint and credentials, then re-run
`load_pluto.py`. No code changes needed in either service.
