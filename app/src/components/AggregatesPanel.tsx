import type { Aggregates } from "../api";

interface AggregatesPanelProps {
  aggregates: Aggregates | null;
  loading: boolean;
}

interface Stat {
  label: string;
  value: number | null | undefined;
  currency?: boolean;
}

export default function AggregatesPanel({ aggregates, loading }: AggregatesPanelProps) {
  const stats: Stat[] = [
    { label: "Parcels in view", value: aggregates?.parcel_count },
    { label: "Residential units", value: aggregates?.total_units_res },
    { label: "Avg floors", value: aggregates?.avg_floors },
    { label: "Avg built FAR", value: aggregates?.avg_built_far },
    { label: "Total assessed value", value: aggregates?.total_assessed_value, currency: true },
  ];

  return (
    <section className="panel aggregates-panel">
      <h2>Viewport aggregates</h2>
      <div className="stat-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">
              {loading ? "…" : formatValue(stat.value, stat.currency)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatValue(value: number | null | undefined, currency?: boolean): string {
  if (value === null || value === undefined) return "—";
  if (currency) return `$${Math.round(value).toLocaleString()}`;
  return value.toLocaleString();
}
