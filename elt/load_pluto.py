"""Load NYC PLUTO parcels (FlatGeobuf, EPSG:4326) into ClickHouse.

Streams the source file in batches via pyogrio's numpy-level reader (no
geopandas dependency), converts each geometry straight into the nested
list-of-rings structure that maps 1:1 onto ClickHouse's native
`MultiPolygon` type (Array(Array(Array(Tuple(Float64, Float64))))), and
inserts in chunks. Also computes a per-row bounding box, which is how
tile/viewport queries prune rows since ClickHouse has no spatial index yet.
"""

import os
import sys
import urllib.request
from pathlib import Path

import clickhouse_connect
import pyogrio
import shapely
from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()

# Public copy of the same file, so a fresh clone works without access to the
# private repo this was originally exported from.
DEFAULT_FGB_URL = "https://pub-449ea338033e4b9b9c4eb640f6f607f2.r2.dev/pluto25_shp_wgs.fgb"
CACHE_PATH = Path(__file__).parent / ".data" / "pluto25_shp_wgs.fgb"

TABLE = "pluto_parcels"
CHUNK_SIZE = 5_000

FIELD_COLUMNS = [
    "landuse",
    "zonedist_simple",
    "assessland",
    "assesstot",
    "numfloors",
    "yearbuilt",
    "unitsres",
    "bldgclass_simple",
    "yearalter1",
    "builtfar",
]

# lotarea/bldgarea are real PLUTO attributes (not derived from geometry —
# an earlier version of this script approximated area by reprojecting and
# measuring the polygon, which was wildly wrong for condo-unit BBLs that
# share a building footprint geometry but carry a near-zero official lot
# area). bbl is PLUTO's real unique parcel id.
EXTRA_COLUMNS = ["bbl", "lotarea", "bldgarea"]
READ_COLUMNS = FIELD_COLUMNS + EXTRA_COLUMNS

# zonedist_simple / bldgclass_simple are non-nullable LowCardinality(String)
# columns; OGR returns None for a handful of rows with no value, so those
# get coerced to '' instead of null.
NON_NULLABLE_STRING_COLUMNS = {"zonedist_simple", "bldgclass_simple"}

ALL_COLUMNS = (
    ["id", "bbl"]
    + FIELD_COLUMNS
    + ["lotarea", "bldgarea", "geom", "min_lon", "min_lat", "max_lon", "max_lat"]
)

CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE}
(
    id UInt32,
    bbl UInt64,
    landuse Nullable(Int32),
    zonedist_simple LowCardinality(String),
    assessland Nullable(Float64),
    assesstot Nullable(Float64),
    numfloors Nullable(Float64),
    yearbuilt Nullable(Int32),
    unitsres Nullable(Int64),
    bldgclass_simple LowCardinality(String),
    yearalter1 Nullable(Int32),
    builtfar Nullable(Float64),
    lotarea Nullable(Int64),
    bldgarea Nullable(Int64),
    geom MultiPolygon,
    min_lon Float64,
    min_lat Float64,
    max_lon Float64,
    max_lat Float64,
    INDEX idx_max_lon max_lon TYPE minmax GRANULARITY 4,
    INDEX idx_max_lat max_lat TYPE minmax GRANULARITY 4
)
ENGINE = MergeTree
ORDER BY (min_lon, min_lat)
"""


def get_client():
    return clickhouse_connect.get_client(
        host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
        port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        secure=os.environ.get("CLICKHOUSE_SECURE", "false").lower() == "true",
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
    )


def ring_to_points(ring_coords):
    # shapely ring coords are already closed (first point == last point),
    # which is what ClickHouse's Ring/Polygon types expect.
    return [(float(x), float(y)) for x, y in ring_coords]


def polygon_to_rings(polygon):
    rings = [ring_to_points(polygon.exterior.coords)]
    for interior in polygon.interiors:
        rings.append(ring_to_points(interior.coords))
    return rings


def geom_to_multipolygon(geom):
    """Convert a shapely geometry into ClickHouse's nested MultiPolygon shape."""
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        return [polygon_to_rings(geom)]
    if geom.geom_type == "MultiPolygon":
        return [polygon_to_rings(poly) for poly in geom.geoms]
    raise ValueError(f"unsupported geometry type: {geom.geom_type}")


def resolve_fgb_path() -> str:
    """PLUTO_FGB_PATH if it points at a real file, else download PLUTO_FGB_URL
    (default: the public R2 copy) to a local cache and use that."""
    local_path = os.environ.get("PLUTO_FGB_PATH")
    if local_path and os.path.exists(local_path):
        return local_path

    if CACHE_PATH.exists():
        return str(CACHE_PATH)

    url = os.environ.get("PLUTO_FGB_URL", DEFAULT_FGB_URL)
    print(f"no local PLUTO_FGB_PATH, downloading from {url}", file=sys.stderr)
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = CACHE_PATH.with_suffix(".tmp")
    # R2's r2.dev public URLs sit behind Cloudflare's bot protection, which
    # 403s urllib's default "Python-urllib/x.y" User-Agent.
    request = urllib.request.Request(url, headers={"User-Agent": "ch-mvt-test-elt"})
    with urllib.request.urlopen(request) as response:
        total = int(response.headers.get("Content-Length", 0))
        with (
            open(tmp_path, "wb") as f,
            tqdm(total=total, unit="B", unit_scale=True, desc="downloading fgb") as pbar,
        ):
            while chunk := response.read(1024 * 1024):
                f.write(chunk)
                pbar.update(len(chunk))
    tmp_path.rename(CACHE_PATH)
    return str(CACHE_PATH)


def clean(value):
    """numpy scalar -> python native, NaN -> None."""
    if value is None:
        return None
    try:
        if value != value:  # NaN check, works for numpy floats too
            return None
    except TypeError:
        pass
    return value.item() if hasattr(value, "item") else value


def main():
    fgb_path = resolve_fgb_path()
    info = pyogrio.read_info(fgb_path)
    total = info["features"]
    print(f"loading {total} features from {fgb_path}", file=sys.stderr)

    client = get_client()
    client.command(f"DROP TABLE IF EXISTS {TABLE}")
    client.command(CREATE_TABLE_SQL)

    next_id = 1
    skipped = 0

    with tqdm(total=total, unit="rows") as pbar:
        skip = 0
        while skip < total:
            meta, _, geom_wkb, fields = pyogrio.raw.read(
                fgb_path,
                columns=READ_COLUMNS,
                skip_features=skip,
                max_features=CHUNK_SIZE,
                force_2d=True,
            )
            n = len(geom_wkb)
            if n == 0:
                break

            # pyogrio returns fields in the source's own column order, not
            # the order `columns` was requested in — zip against the actual
            # returned order (meta["fields"]), not READ_COLUMNS.
            field_cols = dict(zip(meta["fields"], fields))
            rows = []
            for i in range(n):
                geom = shapely.from_wkb(geom_wkb[i])
                try:
                    multipolygon = geom_to_multipolygon(geom)
                except ValueError:
                    multipolygon = None
                if multipolygon is None:
                    skipped += 1
                    continue

                min_lon, min_lat, max_lon, max_lat = geom.bounds
                bbl = clean(field_cols["bbl"][i])
                row = [next_id, int(bbl) if bbl is not None else 0]
                for col in FIELD_COLUMNS:
                    value = clean(field_cols[col][i])
                    if value is None and col in NON_NULLABLE_STRING_COLUMNS:
                        value = ""
                    row.append(value)
                row += [
                    clean(field_cols["lotarea"][i]),
                    clean(field_cols["bldgarea"][i]),
                    multipolygon,
                    min_lon,
                    min_lat,
                    max_lon,
                    max_lat,
                ]
                rows.append(row)
                next_id += 1

            if rows:
                client.insert(TABLE, rows, column_names=ALL_COLUMNS)

            skip += n
            pbar.update(n)

    print(
        f"done. inserted {next_id - 1} rows, skipped {skipped} rows with no usable geometry",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
