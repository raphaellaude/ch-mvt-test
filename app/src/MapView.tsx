import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap, type LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { tileUrl } from "./api";
import { DEFAULT_VALUE_BREAKS, valueBreaksToStepExpression } from "./colorScale";

// Rough NYC bounding box (padded slightly beyond the PLUTO dataset's own
// bounds), used to keep the map from panning off into the ocean.
const NYC_BOUNDS: [number, number, number, number] = [-74.3, 40.47, -73.65, 40.94];

interface MapViewProps {
  onMoveEnd: (bounds: LngLatBounds) => void;
  onZoomChange: (zoom: number) => void;
  valueBreaks: readonly number[];
}

export default function MapView({ onMoveEnd, onZoomChange, valueBreaks }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  // Keep the latest callbacks in refs so the map effect below doesn't need
  // to re-run (and re-create the map) every time the parent re-renders.
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // No basemap for now, per the brief — just a solid background so the
      // parcels are the only thing on screen.
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#11151c" } },
        ],
      },
      center: [-73.97, 40.75],
      zoom: 12,
      minZoom: 11,
      maxBounds: NYC_BOUNDS,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("parcels", {
        type: "vector",
        tiles: [tileUrl],
        minzoom: 11,
      });

      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        paint: {
          // Placeholder — immediately overwritten by the valueBreaks effect
          // below once the first live /aggregates response lands.
          "fill-color": valueBreaksToStepExpression(DEFAULT_VALUE_BREAKS) as never,
          "fill-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "parcels-outline",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        paint: {
          "line-color": "#0b0d12",
          "line-width": 0.4,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

      map.on("mousemove", "parcels-fill", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature) return;
        const p = feature.properties as Record<string, unknown>;
        const assessed = Number(p.assesstot ?? 0);
        const lotarea = Number(p.lotarea ?? 0);
        const perSqft = lotarea > 0 ? assessed / lotarea : null;
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="parcel-popup">
              <strong>Bldg class ${p.bldgclass_simple || "—"}</strong><br/>
              Zoning: ${p.zonedist_simple || "—"}<br/>
              Floors: ${p.numfloors ?? "—"} · Built ${p.yearbuilt || "—"}<br/>
              Assessed: $${assessed.toLocaleString()}${perSqft !== null ? ` ($${perSqft.toFixed(0)}/sqft)` : ""}
            </div>`,
          )
          .addTo(map);
      });

      map.on("mouseleave", "parcels-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      onMoveEndRef.current(map.getBounds());
      onZoomChangeRef.current(map.getZoom());
      loadedRef.current = true;
    });

    map.on("moveend", () => onMoveEndRef.current(map.getBounds()));
    map.on("zoom", () => onZoomChangeRef.current(map.getZoom()));

    return () => {
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Repaint the choropleth whenever the viewport's assessed-value quantile
  // breaks are recomputed (see App.tsx / api.ts `value_breaks`).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setPaintProperty("parcels-fill", "fill-color", valueBreaksToStepExpression(valueBreaks));
  }, [valueBreaks]);

  return <div ref={containerRef} className="map-container" />;
}
