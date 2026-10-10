import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { Analytics, Lookups } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { ErrorState, ExportButton, Loading, Panel } from './common';
import { FilterBar, type FilterDef } from './FilterBar';
import { exportCsv, label, number } from '../../lib/utils';

// One colour per status, shared with the badges: green = done, blue = moving, amber = waiting,
// purple = rework, red = problem, grey = not started.
const statusColors: Record<string, string> = {
  PASSED: '#087f6b', RUNNING: '#087f6b', COMPLETED: '#087f6b',
  IN_PROGRESS: '#3567a3', DISPATCHED: '#3567a3',
  PENDING: '#b7791f', READY: '#b7791f', IDLE: '#b7791f',
  REWORK: '#7056a3', PAUSED: '#7056a3',
  REJECTED: '#b83940', BREAKDOWN: '#b83940', BLOCKED: '#b83940', CANCELLED: '#b83940',
  PLANNED: '#5b6b64',
};
const statusColor = (status: string) => statusColors[status] ?? '#5b6b64';

// Factory analytics: every chart is built from real records by GET /analytics.
// Colours were checked with the palette validator (lightness, chroma, colour-blind separation).

// One fixed colour per production stage, used by every chart (colour follows the stage).
const stageColors: Record<string, string> = { SPINNING: '#2f6cb8', WEAVING: '#bf8014', DYEING: '#7056a3' };
// Ordered → produced → dispatched is a progression, so it uses one hue from light to dark.
const progressRamp = ['#86a9d9', '#4a7fc8', '#1f4f8f'];
// Batch status groups shown in the app's shared status colours.
const statusTone: Record<string, string> = { PENDING: 'PENDING', ONGOING: 'IN_PROGRESS', REWORK: 'REWORK', COMPLETED: 'COMPLETED', FAILED: 'CANCELLED' };
const BAR = 24; // bars never thicker than this
const SURFACE = '#ffffff'; // gap colour between touching bars
const axis = { fontSize: 12, fill: '#3b4049' };
const grid = <CartesianGrid stroke="#e6ece8" vertical={false} />;
const tooltipStyle = { borderRadius: 10, border: '1px solid #d9e3dd', fontSize: 12 };

export function FactoryAnalytics({ lookups }: { lookups: Lookups | undefined }) {
  const navigate = useNavigate();
  const [f, setF] = useState<Record<string, string>>({ from: '', to: '', buyerId: '', stage: '' });
  const query = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const data = useData<Analytics>(`/analytics${query ? `?${query}` : ''}`);

  const filters: FilterDef[] = [
    { name: 'from', label: 'From', type: 'date' },
    { name: 'to', label: 'To', type: 'date' },
    { name: 'buyerId', label: 'Customer', options: (lookups?.buyers ?? []).map((b) => ({ value: b.id, label: b.name })) },
    { name: 'stage', label: 'Department', options: ['SPINNING', 'WEAVING', 'DYEING'].map((s) => ({ value: s, label: label(s) })) },
  ];

  const a = data.data;
  const stages = f.stage ? [f.stage] : ['SPINNING', 'WEAVING', 'DYEING'];

  return (
    <section style={{ marginTop: 8 }}>
      <Panel
        title="Factory analytics"
        subtitle={a ? `${new Date(a.from).toLocaleDateString('en-IN')} – ${new Date(a.to).toLocaleDateString('en-IN')} · last 14 days unless you pick dates` : 'Loading…'}
        action={
          a && (
            <ExportButton
              onClick={() =>
                exportCsv('factory-analytics', [
                  ...a.dailyOutput.map((d) => ({ section: 'Daily output (m)', item: d.label, spinning: d.SPINNING, weaving: d.WEAVING, dyeing: d.DYEING })),
                  ...a.machineUtilization.map((m) => ({ section: 'Machine utilisation (%)', item: m.code, value: m.utilization, runHours: m.runHours })),
                  ...a.rework.byType.map((r) => ({ section: 'Rework', item: label(r.type), count: r.count, metres: r.quantity })),
                  ...a.customers.map((c) => ({ section: 'Customers (m)', item: c.buyer, ordered: c.ordered, produced: c.produced, dispatched: c.dispatched })),
                ])
              }
            />
          )
        }
      >
        <FilterBar
          filters={filters}
          values={f}
          onChange={(name, value) => setF({ ...f, [name]: value })}
          onClear={() => setF({ from: '', to: '', buyerId: '', stage: '' })}
          active={Object.values(f).filter(Boolean).length}
        />
        {data.isPending && <Loading />}
        {data.error && <ErrorState error={data.error} retry={() => void data.refetch()} />}
      </Panel>

      {a && (
        <div className="analytics-grid" style={{ marginTop: 16 }}>
          <Panel title="Daily production output" subtitle="Metres recorded per day, by department" className="span-2">
            <div className="chart-box">
              <ResponsiveContainer>
                <BarChart data={a.dailyOutput} barCategoryGap="25%">
                  {grid}
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: '#d9e3dd' }} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} width={48} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${number(Number(v))} m`, label(String(n))]} cursor={{ fill: '#eef3f0' }} />
                  <Legend itemSorter={null} formatter={(v) => <span style={{ color: '#2f443a' }}>{label(String(v))}</span>} iconType="square" />
                  {stages.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="out" fill={stageColors[s]} stroke={SURFACE} strokeWidth={2} maxBarSize={BAR} radius={i === stages.length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Output by department" subtitle="Total metres and waste in the period">
            <div className="chart-box">
              <ResponsiveContainer>
                <BarChart data={a.departmentOutput.map((d) => ({ ...d, name: label(d.stage) }))} layout="vertical" margin={{ right: 56 }}>
                  <CartesianGrid stroke="#e6ece8" horizontal={false} />
                  <XAxis type="number" tick={axis} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={72} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, item) => [`${number(Number(v))} m · waste ${number(item.payload.waste)} m`, 'Output']} cursor={{ fill: '#eef3f0' }} />
                  <Bar dataKey="output" maxBarSize={BAR} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#2f443a', fontSize: 12, formatter: (v: unknown) => `${number(Number(v))} m` }}>
                    {a.departmentOutput.map((d) => <Cell key={d.stage} fill={stageColors[d.stage]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Production status" subtitle="All batches right now · click a bar to see them">
            <div className="chart-box">
              <ResponsiveContainer>
                <BarChart data={a.productionStatus.map((s) => ({ ...s, name: label(s.status) }))} layout="vertical" margin={{ right: 40 }}>
                  <CartesianGrid stroke="#e6ece8" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={84} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} batches`, 'Batches']} cursor={{ fill: '#eef3f0' }} />
                  <Bar dataKey="count" maxBarSize={BAR} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#2f443a', fontSize: 12 }} style={{ cursor: 'pointer' }}
                    onClick={(_d, index) => navigate(`/batches?status=${a.productionStatus[index].status}`)}>
                    {a.productionStatus.map((s) => <Cell key={s.status} fill={statusColor(statusTone[s.status])} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Machine utilisation" subtitle="Reported run hours ÷ one 8-hour shift per day">
            <div className="mini-stats">
              {a.machineStatus.map((m) => (
                <div key={m.status}>
                  <strong>{m.count}</strong>
                  <span>{label(m.status)}</span>
                </div>
              ))}
            </div>
            <div className="chart-box" style={{ height: Math.max(180, a.machineUtilization.length * 30) }}>
              <ResponsiveContainer>
                <BarChart data={a.machineUtilization} layout="vertical" margin={{ right: 44 }}>
                  <CartesianGrid stroke="#e6ece8" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} unit="%" tick={axis} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="code" tick={axis} tickLine={false} axisLine={false} width={56} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, item) => [`${v}% · ${number(item.payload.runHours, 1)} h run · now ${label(item.payload.status)}`, 'Utilisation']} cursor={{ fill: '#eef3f0' }} />
                  <Bar dataKey="utilization" maxBarSize={18} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#2f443a', fontSize: 12, formatter: (v: unknown) => `${v}%` }}>
                    {a.machineUtilization.map((m) => <Cell key={m.code} fill={stageColors[m.type] ?? '#596b64'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Quality pass / fail" subtitle="Roll inspections in the period">
            <div className="mini-stats">
              <div>
                <strong>{a.quality.passRate}%</strong>
                <span><CheckCircle2 size={12} /> pass rate</span>
              </div>
              <div>
                <strong>{a.quality.passed}</strong>
                <span>Passed</span>
              </div>
              <div>
                <strong>{a.quality.rework}</strong>
                <span>Rework</span>
              </div>
              <div>
                <strong>{a.quality.rejected}</strong>
                <span>Rejected</span>
              </div>
            </div>
            <div className="chart-box" style={{ height: 190 }}>
              <ResponsiveContainer>
                <BarChart data={a.quality.daily}>
                  {grid}
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: '#d9e3dd' }} />
                  <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={32} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#eef3f0' }} />
                  <Legend itemSorter={null} iconType="square" formatter={(v) => <span style={{ color: '#2f443a' }}>{v}</span>} />
                  <Bar dataKey="passed" name="Passed" stackId="q" fill={statusColor('PASSED')} stroke={SURFACE} strokeWidth={2} maxBarSize={BAR} />
                  <Bar dataKey="failed" name="Rework / rejected" stackId="q" fill={statusColor('REJECTED')} stroke={SURFACE} strokeWidth={2} maxBarSize={BAR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Rework by reason" subtitle={`${a.rework.open} open · ${a.rework.completed} completed in the period`}>
            {a.rework.byType.length ? (
              <>
                <div className="chart-box" style={{ height: Math.max(150, a.rework.byType.length * 34) }}>
                  <ResponsiveContainer>
                    <BarChart data={a.rework.byType.map((r) => ({ ...r, name: label(r.type) }))} layout="vertical" margin={{ right: 40 }}>
                      <CartesianGrid stroke="#e6ece8" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={120} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, item) => [`${v} time(s) · ${number(item.payload.quantity)} m`, 'Rework']} cursor={{ fill: '#eef3f0' }} />
                      <Bar dataKey="count" fill={statusColor('REWORK')} maxBarSize={BAR} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#2f443a', fontSize: 12 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  Sent back to: {a.rework.byStage.map((s) => `${label(s.stage)} ${s.count}`).join(' · ')}
                </p>
              </>
            ) : (
              <p className="muted">No rework in this period.</p>
            )}
          </Panel>

          <Panel title="Production delays" subtitle="Unfinished batches past their due date">
            <div className="mini-stats">
              <div>
                <strong style={{ color: a.delays.delayed ? '#9b2f36' : undefined }}>{a.delays.delayed}</strong>
                <span><AlertTriangle size={12} /> running late</span>
              </div>
              <div>
                <strong>{a.delays.onTime}</strong>
                <span><Clock size={12} /> on schedule</span>
              </div>
            </div>
            {a.delays.late.length ? (
              <ul className="late-list">
                {a.delays.late.map((l) => (
                  <li key={l.id}>
                    <button className="roll-link" style={{ padding: 0 }} onClick={() => navigate(`/batches?open=${l.id}`)}>
                      <strong>{l.number}</strong>
                    </button>
                    <span>{l.daysLate} day{l.daysLate > 1 ? 's' : ''} late · in {label(l.department)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing is running late.</p>
            )}
          </Panel>

          <Panel title="Customer-wise production" subtitle="Metres ordered, produced and dispatched per customer" className="span-2">
            <div className="chart-box" style={{ height: Math.max(200, a.customers.length * 56) }}>
              <ResponsiveContainer>
                <BarChart data={a.customers} layout="vertical" barGap={2} margin={{ right: 24 }}>
                  <CartesianGrid stroke="#e6ece8" horizontal={false} />
                  <XAxis type="number" tick={axis} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="buyer" tick={axis} tickLine={false} axisLine={false} width={120} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${number(Number(v))} m`, String(n)]} cursor={{ fill: '#eef3f0' }} />
                  <Legend itemSorter={null} iconType="square" formatter={(v) => <span style={{ color: '#2f443a' }}>{v}</span>} />
                  <Bar dataKey="ordered" name="Ordered" fill={progressRamp[0]} maxBarSize={14} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="produced" name="Produced" fill={progressRamp[1]} maxBarSize={14} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="dispatched" name="Dispatched" fill={progressRamp[2]} maxBarSize={14} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}
