import type { Reading } from "../supabase/functions/_shared/health";
export function Chart(
  { rows, tab, month }: { rows: Reading[]; tab: string; month: string },
) {
  const defs: { name: string; color: string; points: [number, number][] }[] =
    [];
  const series = (
    name: string,
    color: string,
    key: keyof Reading,
    kind?: string,
  ) =>
    defs.push({
      name,
      color,
      points: rows.filter((r) =>
        (!kind || r.measurement_type === kind) && typeof r[key] === "number"
      ).map((r) => [Number(r.measured_on.slice(-2)), r[key] as number]),
    });
  if (tab === "glucose") {
    series("空腹", "#2f8771", "glucose_mmol", "fasting");
    series("餐後", "#a7742b", "glucose_mmol", "postmeal");
    series("其他", "#657891", "glucose_mmol", "other");
  } else if (tab === "pressure") {
    series("收縮壓", "#ae5846", "systolic");
    series("舒張壓", "#657891", "diastolic");
  } else {series(
      tab === "weight" ? "體重" : "心率",
      "#2f795d",
      tab === "weight" ? "weight_kg" : "pulse",
    );}
  const vals = defs.flatMap((s) => s.points.map((p) => p[1]));
  if (!vals.length) return <p className="empty-chart">這個月還沒有這項紀錄</p>;
  const base = Math.min(...vals),
    range = Math.max(1, Math.max(...vals) - base),
    lo = Math.max(0, base - range * .25),
    hi = Math.max(...vals) + range * .25;
  const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0))
    .getUTCDate();
  const x = (d: number) => 40 + (d - 1) / (days - 1) * 626,
    y = (v: number) => 15 + (hi - v) / (hi - lo) * 167;
  return (
    <>
      <div className="chart-legend">
        {defs.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        viewBox="0 0 680 214"
        role="img"
        aria-label={`${month}健康曲線，數值可在下方紀錄中查看`}
      >
        {Array.from({ length: 5 }, (_, i) => {
          const v = lo + i * (hi - lo) / 4;
          return (
            <g key={i}>
              <line
                x1="40"
                y1={y(v)}
                x2="666"
                y2={y(v)}
                stroke="#dce6dc"
                strokeDasharray="3 5"
              />
              <text x="32" y={y(v) + 4} textAnchor="end" className="axis-label">
                {v.toFixed(tab === "glucose" ? 1 : 0)}
              </text>
            </g>
          );
        })}
        {[1, 5, 10, 15, 20, 25, days].map((d) => (
          <text
            key={d}
            x={x(d)}
            y="207"
            textAnchor="middle"
            className="axis-label"
          >
            {d}日
          </text>
        ))}
        {defs.map((s) => (
          <g key={s.name}>
            <path
              d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p[0])},${y(p[1])}`)
                .join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
            />
            {s.points.map((p, i) => (
              <circle key={i} cx={x(p[0])} cy={y(p[1])} r="4.5" fill={s.color}>
                <title>{s.name} {p[1]}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
    </>
  );
}
