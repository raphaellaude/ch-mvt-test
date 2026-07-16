import { VALUE_COLORS, formatCompactCurrency } from "../colorScale";

interface LegendProps {
  valueBreaks: readonly number[];
  loading: boolean;
}

export default function Legend({ valueBreaks, loading }: LegendProps) {
  const edges = [0, ...valueBreaks];

  return (
    <div className={`legend${loading ? " legend-loading" : ""}`}>
      <div className="legend-title">Assessed value / sqft</div>
      {VALUE_COLORS.map((color, i) => (
        <div className="legend-row" key={color}>
          <span className="legend-swatch" style={{ background: color }} />
          <span className="legend-label">{legendLabel(edges, i)}</span>
        </div>
      ))}
      <div className="legend-note">quantiles of the current viewport</div>
    </div>
  );
}

function legendLabel(edges: number[], i: number): string {
  if (i === 0) return `< ${formatCompactCurrency(edges[1])}`;
  if (i === edges.length - 1) return `${formatCompactCurrency(edges[i])}+`;
  return `${formatCompactCurrency(edges[i])}–${formatCompactCurrency(edges[i + 1])}`;
}
