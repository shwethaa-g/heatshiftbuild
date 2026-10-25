// ramp: {title, stops:[{at,color,label}]}; items: [{kind:'dot'|'line', color, dashed, label}]
export default function Legend({ ramp, items = [] }) {
  return (
    <div className="legend">
      {ramp && (
        <span className="ramp">
          <span>{ramp.title}</span>
          <span
            className="bar"
            style={{ background: `linear-gradient(90deg, ${ramp.stops.map((s) => s.color).join(', ')})` }}
          />
          <span>
            {ramp.stops[0].label} → {ramp.stops[ramp.stops.length - 1].label}
          </span>
        </span>
      )}
      {items.map((it) => (
        <span key={it.label}>
          {it.kind === 'line' ? (
            <span
              className="line"
              style={{ borderTop: `${it.width || 3}px ${it.dashed ? 'dashed' : 'solid'} ${it.color}` }}
            />
          ) : (
            <span className="dot" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}
