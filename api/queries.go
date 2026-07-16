package main

// These three query strings are the entire SQL surface of this API — fixed
// at compile time, never built from request input. Every value from the
// request (z/x/y, viewport bbox) is bound through ClickHouse's native
// `{name:Type}` HTTP parameters (see clickhouse.go), so a request can only
// ever change the parameter values, never the query shape.

// lotarea is a real PLUTO attribute (not derived from geometry — see
// elt/load_pluto.py) included in every tile feature's properties so the map
// can compute assessed-value-per-sqft client-side (cheap MapLibre paint-time
// arithmetic on two stored numbers) instead of ClickHouse dividing on every
// request.
const tileQuery = `
WITH 1 AS buffer, 4096 AS extent,
     MVTBoundingBox({z:UInt8}, {x:UInt32}, {y:UInt32}, buffer / extent) AS bb
SELECT MVTEncode('parcels')(
    MVTEncodeGeom(geom, {z:UInt8}, {x:UInt32}, {y:UInt32}, extent, buffer),
    tuple(id, landuse, zonedist_simple, assessland, assesstot, numfloors, yearbuilt,
          unitsres, bldgclass_simple, yearalter1, builtfar, lotarea)
      ::Tuple(id UInt32, landuse Nullable(Int32), zonedist_simple String, assessland Nullable(Float64),
               assesstot Nullable(Float64), numfloors Nullable(Float64), yearbuilt Nullable(Int32),
               unitsres Nullable(Int64), bldgclass_simple String, yearalter1 Nullable(Int32), builtfar Nullable(Float64),
               lotarea Nullable(Int64))
)
FROM pluto_parcels
WHERE min_lon <= bb.3 AND max_lon >= bb.1 AND min_lat <= bb.4 AND max_lat >= bb.2
FORMAT RawBLOB
`

// value_breaks are the 20th/40th/60th/80th percentiles of assessed value
// per square foot (assesstot / lotarea, PLUTO's real lot-area attribute)
// within the current viewport, recomputed on every request — the frontend
// uses them to redraw the choropleth's color breaks (and its legend) so
// they always reflect what's actually on screen, instead of a fixed global
// scale. Using $/sqft rather than raw assessed value keeps a handful of
// huge parcels from dominating the color scale. A small number of
// condo-unit BBLs carry a near-zero official lotarea (they share a building
// footprint with other units in the same building); nullif keeps those out
// of both the ratio and the quantile calc instead of producing bogus
// thousands-of-dollars-per-sqft outliers.
const aggregatesQuery = `
SELECT
    count() AS parcel_count,
    sum(unitsres) AS total_units_res,
    round(avg(numfloors), 2) AS avg_floors,
    round(avg(builtfar), 2) AS avg_built_far,
    sum(assesstot) AS total_assessed_value,
    arrayMap(x -> round(x, 1), quantiles(0.2, 0.4, 0.6, 0.8)(assesstot / nullif(lotarea, 0))) AS value_breaks
FROM pluto_parcels
WHERE min_lon <= {maxLon:Float64} AND max_lon >= {minLon:Float64}
  AND min_lat <= {maxLat:Float64} AND max_lat >= {minLat:Float64}
FORMAT JSON
`

const topParcelsQuery = `
SELECT
    id, landuse, zonedist_simple, bldgclass_simple, numfloors,
    yearbuilt, unitsres, assessland, assesstot, builtfar, lotarea,
    round(assesstot / nullif(lotarea, 0), 2) AS av_per_sqft
FROM pluto_parcels
WHERE min_lon <= {maxLon:Float64} AND max_lon >= {minLon:Float64}
  AND min_lat <= {maxLat:Float64} AND max_lat >= {minLat:Float64}
ORDER BY assesstot DESC
LIMIT 100
FORMAT JSON
`
