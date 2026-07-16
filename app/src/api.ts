import type { LngLatBounds } from "maplibre-gl";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8090";

export const tileUrl = `${API_URL}/tile/{z}/{x}/{y}`;

export interface Aggregates {
  parcel_count: number;
  total_units_res: number | null;
  avg_floors: number | null;
  avg_built_far: number | null;
  total_assessed_value: number | null;
  // 20th/40th/60th/80th percentiles of assessed value per square foot
  // (assesstot / lotarea, PLUTO's real lot-area attribute) within the
  // current viewport, recomputed on every request.
  value_breaks: [number, number, number, number];
}

export interface Parcel {
  id: number;
  landuse: number | null;
  zonedist_simple: string;
  bldgclass_simple: string;
  numfloors: number | null;
  yearbuilt: number | null;
  unitsres: number | null;
  assessland: number | null;
  assesstot: number | null;
  builtfar: number | null;
  lotarea: number | null;
  av_per_sqft: number | null;
}

// Shape of ClickHouse's `FORMAT JSON` output, which the Go API passes
// through unmodified.
interface ClickHouseJSON<T> {
  data: T[];
}

function bboxParams(bounds: LngLatBounds): URLSearchParams {
  return new URLSearchParams({
    minLon: String(bounds.getWest()),
    minLat: String(bounds.getSouth()),
    maxLon: String(bounds.getEast()),
    maxLat: String(bounds.getNorth()),
  });
}

export async function fetchAggregates(
  bounds: LngLatBounds,
  signal?: AbortSignal,
): Promise<Aggregates> {
  const res = await fetch(`${API_URL}/aggregates?${bboxParams(bounds)}`, { signal });
  if (!res.ok) throw new Error(`aggregates request failed: ${res.status}`);
  const json: ClickHouseJSON<Aggregates> = await res.json();
  return json.data[0];
}

export async function fetchTopParcels(
  bounds: LngLatBounds,
  signal?: AbortSignal,
): Promise<Parcel[]> {
  const res = await fetch(`${API_URL}/top-parcels?${bboxParams(bounds)}`, { signal });
  if (!res.ok) throw new Error(`top-parcels request failed: ${res.status}`);
  const json: ClickHouseJSON<Parcel> = await res.json();
  return json.data;
}
