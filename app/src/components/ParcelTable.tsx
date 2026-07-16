import type { Parcel } from "../api";

interface ParcelTableProps {
  parcels: Parcel[];
  loading: boolean;
}

export default function ParcelTable({ parcels, loading }: ParcelTableProps) {
  return (
    <section className="panel table-panel">
      <h2>
        Top 100 parcels in view <span className="subtle">by assessed value</span>
      </h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Class</th>
              <th>Zoning</th>
              <th>Floors</th>
              <th>Built</th>
              <th>Units</th>
              <th>Assessed</th>
              <th>$/sqft</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="empty">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && parcels.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No parcels in view
                </td>
              </tr>
            )}
            {!loading &&
              parcels.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.bldgclass_simple || "—"}</td>
                  <td>{p.zonedist_simple || "—"}</td>
                  <td>{p.numfloors ?? "—"}</td>
                  <td>{p.yearbuilt || "—"}</td>
                  <td>{p.unitsres ?? "—"}</td>
                  <td>{p.assesstot != null ? `$${Math.round(p.assesstot).toLocaleString()}` : "—"}</td>
                  <td>{p.av_per_sqft != null ? `$${Math.round(p.av_per_sqft).toLocaleString()}` : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
