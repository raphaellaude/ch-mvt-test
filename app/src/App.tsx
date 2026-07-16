import { useCallback, useRef, useState } from "react";
import type { LngLatBounds } from "maplibre-gl";
import MapView from "./MapView";
import AggregatesPanel from "./components/AggregatesPanel";
import ParcelTable from "./components/ParcelTable";
import Legend from "./components/Legend";
import { fetchAggregates, fetchTopParcels, type Aggregates, type Parcel } from "./api";
import { DEFAULT_VALUE_BREAKS } from "./colorScale";
import "./App.css";

const DEBOUNCE_MS = 300;

function App() {
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const handleMoveEnd = useCallback((bounds: LngLatBounds) => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const [agg, top] = await Promise.all([
          fetchAggregates(bounds, controller.signal),
          fetchTopParcels(bounds, controller.signal),
        ]);
        setAggregates(agg);
        setParcels(top);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error(err);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-title">
          <h1>NYC PLUTO Parcels</h1>
          {zoom !== null && <span className="zoom-badge">Zoom {zoom.toFixed(1)}</span>}
        </div>
        <p>856k parcels — vector tiles and live viewport aggregates.</p>
      </header>
      <main className="app-body">
        <div className="map-wrap">
          <MapView
            onMoveEnd={handleMoveEnd}
            onZoomChange={setZoom}
            valueBreaks={aggregates?.value_breaks ?? DEFAULT_VALUE_BREAKS}
          />
          <Legend valueBreaks={aggregates?.value_breaks ?? DEFAULT_VALUE_BREAKS} loading={loading} />
        </div>
        <aside className="sidebar">
          <AggregatesPanel aggregates={aggregates} loading={loading && !aggregates} />
          <ParcelTable parcels={parcels} loading={loading && parcels.length === 0} />
        </aside>
      </main>
    </div>
  );
}

export default App;
