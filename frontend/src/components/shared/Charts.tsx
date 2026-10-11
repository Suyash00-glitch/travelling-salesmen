import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

// Shared chart pieces. Colours are assigned by meaning, never cycled:
// - `series`: categories (fixed order, checked for colour-blind separation; legends always show labels and values)
// - `status`: states (good / warning / serious / critical) — always shown with a label, never colour alone
export const series = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const;
export const status = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  neutral: '#9aa0a8',
  info: '#2a78d6',
} as const;
// One fixed colour per production stage, used by every chart (colour follows the stage).
export const stageColors: Record<string, string> = { SPINNING: '#2f6cb8', WEAVING: '#bf8014', DYEING: '#7056a3' };

export const axis = { fontSize: 12, fill: '#3b4049' };
export const tooltipStyle = { borderRadius: 12, border: '1px solid #e3e6ea', fontSize: 12, boxShadow: '0 8px 20px rgb(16 24 40 / 10%)' };

export interface Slice {
  name: string;
  value: number;
  color: string;
  key?: string;
}

// Part-of-whole with a few categories. The centre shows the total; the legend shows every
// category with its value and share, so nothing depends on colour alone.
export function Donut({
  data,
  centre,
  caption,
  format = (v) => v.toLocaleString('en-IN'),
  onSelect,
}: {
  data: Slice[];
  centre?: string;
  caption?: string;
  format?: (value: number) => string;
  onSelect?: (slice: Slice) => void;
}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const shown = data.filter((d) => d.value > 0);
  return (
    <div className="donut">
      <div className="donut-chart">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={shown.length ? shown : [{ name: 'Nothing yet', value: 1, color: '#eceef1' }]}
              dataKey="value"
              nameKey="name"
              innerRadius="64%"
              outerRadius="96%"
              paddingAngle={shown.length > 1 ? 2 : 0}
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(d: { payload?: Slice }) => d?.payload && onSelect?.(d.payload)}
              style={{ cursor: onSelect ? 'pointer' : undefined }}
            >
              {(shown.length ? shown : [{ color: '#eceef1', name: 'none' }]).map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            {shown.length > 0 && (
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, n) => [`${format(Number(v))} · ${Math.round((Number(v) / total) * 100)}%`, String(n)]}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-centre">
          <strong>{centre ?? format(total)}</strong>
          {caption && <span>{caption}</span>}
        </div>
      </div>
      <ul className="donut-legend">
        {data.map((d) => (
          <li key={d.name} className={onSelect ? 'clickable' : ''} onClick={() => onSelect?.(d)}>
            <i style={{ background: d.color }} />
            <span>{d.name}</span>
            <strong>{format(d.value)}</strong>
            <small>{total ? `${Math.round((d.value / total) * 100)}%` : '–'}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A labelled horizontal bar per row: easy to read on a phone, no axis needed.
export function BarList({
  rows,
  format = (v) => v.toLocaleString('en-IN'),
  onSelect,
  scaleMax,
}: {
  rows: { label: string; value: number; color: string; key?: string }[];
  format?: (value: number) => string;
  onSelect?: (row: { label: string; key?: string }) => void;
  scaleMax?: number;
}) {
  const max = scaleMax ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbar-list">
      {rows.map((r) => (
        <div key={r.label} className={`hbar ${onSelect ? 'clickable' : ''}`} onClick={() => onSelect?.(r)}>
          <span>{r.label}</span>
          <div className="hbar-track">
            <div style={{ width: `${Math.max(r.value ? 3 : 0, (r.value / max) * 100)}%`, background: r.color }} />
          </div>
          <strong>{format(r.value)}</strong>
        </div>
      ))}
    </div>
  );
}
