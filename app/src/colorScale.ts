// Shared between MapView (paint expression) and Legend (swatches) so the
// map and its legend can never drift out of sync.
// 5-class YlGn (ColorBrewer / matplotlib), low value -> high value.
export const VALUE_COLORS = ["#ffffcc", "#c2e699", "#78c679", "#31a354", "#006837"] as const;

// Sane default ($/sqft) until the first live /aggregates response arrives.
export const DEFAULT_VALUE_BREAKS: [number, number, number, number] = [50, 120, 250, 500];

// assesstot / lotarea as a MapLibre expression — lotarea is a real PLUTO
// attribute loaded straight from the source data (see elt/load_pluto.py),
// not derived from geometry, so this is just cheap paint-time arithmetic on
// two stored numbers. Using $/sqft rather than raw assessed value keeps a
// handful of huge parcels from dominating the color scale.
const AV_PER_SQFT_EXPR = [
  "/",
  ["coalesce", ["get", "assesstot"], 0],
  ["max", ["coalesce", ["get", "lotarea"], 1], 1],
];

// MapLibre's `step` expression: [step, input, output0, stop1, output1, stop2, output2, ...]
// Breaks must be strictly increasing, or MapLibre throws — quantiles from a
// very uniform viewport can tie, so this nudges duplicates apart.
export function valueBreaksToStepExpression(breaks: readonly number[]): unknown[] {
  const sorted = ensureStrictlyIncreasing(breaks);
  const expr: unknown[] = ["step", AV_PER_SQFT_EXPR, VALUE_COLORS[0]];
  sorted.forEach((breakValue, i) => {
    expr.push(breakValue, VALUE_COLORS[i + 1]);
  });
  return expr;
}

function ensureStrictlyIncreasing(breaks: readonly number[]): number[] {
  const result: number[] = [];
  for (const value of breaks) {
    const prev = result[result.length - 1];
    result.push(prev !== undefined && value <= prev ? prev + 1 : value);
  }
  return result;
}

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompactCurrency(value: number): string {
  return compactCurrency.format(value);
}
