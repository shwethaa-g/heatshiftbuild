export default function StatCard({ label, value, sub, source, children }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      {value != null && <div className="value">{value}</div>}
      {sub && <div className="sub">{sub}</div>}
      {children}
      {source && <div className="source">{source}</div>}
    </div>
  );
}
