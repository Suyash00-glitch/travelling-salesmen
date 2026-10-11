import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { Analytics, Lookups } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { ErrorState, ExportButton, Loading, Panel } from './common';
import { FilterBar, type FilterDef } from './FilterBar';
import { BarList, Donut, axis, stageColors, status, tooltipStyle } from './Charts';
import { exportCsv, label, number } from '../../lib/utils';

// Factory analytics: every chart is built from real records by GET /analytics.
// Part-of-whole uses donuts with labelled legends; rankings use labelled bars.

// Batch status groups in the shared status colours.
const statusTone: Record<string, string> = {
  PENDING: status.neutral,
  ONGOING: status.info,
  REWORK: status.warning,
  COMPLETED: status.good,
  FAILED: status.critical,
};
// Ordered → produced → dispatched is a progression, so it uses one hue from light to dark.
const progressRamp = ['#86b6ef', '#3987e5', '#184f95'];
const BAR = 24;
const grid = <CartesianGrid stroke="#eceef1" vertical={false} />;

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
            <div className="chart-box" style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={a.dailyOutput} barCategoryGap="25%" margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  {grid}
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: '#d9dde2' }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} width={48} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${number(Number(v))} m`, label(String(n))]} cursor={{ fill: '#f3f4f6' }} />
                  <Legend formatter={(v) => <span style={{ color: '#1f2227' }}>{label(String(v))}</span>} iconType="square" />
                  {stages.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="out" fill={stageColors[s]} stroke="#ffffff" strokeWidth={2} maxBarSize={BAR} radius={i === stages.length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Output by department" subtitle="Share of all metres made in the period">
            <Donut
              data={a.departmentOutput.map((d) => ({ name: label(d.stage), value: d.output, color: stageColors[d.stage] }))}
              caption="metres"
              format={(v) => `${number(v)} m`}
              centre={number(a.departmentOutput.reduce((s, d) => s + d.output, 0))}
            />
            <p className="chart-note">
              Waste: {a.departmentOutput.map((d) => `${label(d.stage)} ${number(d.waste)} m`).join(' · ')}
            </p>
          </Panel>

          <Panel title="Quality results" subtitle={`Roll inspections in the period · ${a.quality.passRate}% passed`}>
            <Donut
              data={[
                { name: 'Passed', value: a.quality.passed, color: status.good },
                { name: 'Rework', value: a.quality.rework, color: status.warning },
                { name: 'Rejected', value: a.quality.rejected, color: status.critical },
              ]}
              centre={`${a.quality.passRate}%`}
              caption="pass rate"
              onSelect={() => navigate('/quality')}
            />
          </Panel>

          <Panel title="Production status" subtitle="All batches right now · tap a row to see them">
            <BarList
              rows={a.productionStatus.map((s) => ({ key: s.status, label: label(s.status), value: s.count, color: statusTone[s.status] ?? status.neutral }))}
              onSelect={(r) => navigate(`/batches?status=${r.key}`)}
            />
          </Panel>

          <Panel title="Rework by reason" subtitle={`${a.rework.open} open · ${a.rework.completed} completed in the period`}>
            {a.rework.byType.length ? (
              <>
                <BarList rows={a.rework.byType.map((r) => ({ label: label(r.type), value: r.count, color: status.warning }))} />
                <p className="chart-note">Sent back to: {a.rework.byStage.map((s) => `${label(s.stage)} ${s.count}`).join(' · ')}</p>
              </>
            ) : (
              <p className="muted">No rework in this period.</p>
            )}
          </Panel>

          <Panel title="Machine utilisation" subtitle="Reported run hours ÷ one 8-hour shift per day" className="span-2">
            <div className="mini-stats">
              {a.machineStatus.map((m) => (
                <div key={m.status}>
                  <strong>{m.count}</strong>
                  <span>{label(m.status)}</span>
                </div>
              ))}
            </div>
            <div className="chart-box" style={{ height: Math.max(180, a.machineUtilization.length * 32) }}>
              <ResponsiveContainer>
                <BarChart data={a.machineUtilization} layout="vertical" margin={{ left: 0, right: 48, top: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#eceef1" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} unit="%" tick={axis} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="code" tick={axis} tickLine={false} axisLine={false} width={56} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, item) => [`${v}% · ${number(item.payload.runHours, 1)} h run · now ${label(item.payload.status)}`, 'Utilisation']} cursor={{ fill: '#f3f4f6' }} />
                  <Bar dataKey="utilization" maxBarSize={18} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#1f2227', fontSize: 12, formatter: (v: unknown) => `${v}%` }}>
                    {a.machineUtilization.map((m) => <Cell key={m.code} fill={stageColors[m.type] ?? '#596b64'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Quality by day" subtitle="Passed against rework or rejected, per day">
            <div className="chart-box" style={{ height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={a.quality.daily} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  {grid}
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: '#d9dde2' }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={32} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f3f4f6' }} />
                  <Legend iconType="square" formatter={(v) => <span style={{ color: '#1f2227' }}>{v}</span>} />
                  <Bar dataKey="passed" name="Passed" stackId="q" fill={status.good} stroke="#ffffff" strokeWidth={2} maxBarSize={BAR} />
                  <Bar dataKey="failed" name="Rework / rejected" stackId="q" fill={status.critical} stroke="#ffffff" strokeWidth={2} maxBarSize={BAR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Production delays" subtitle="Unfinished batches past their due date">
            <div className="mini-stats">
              <div>
                <strong style={{ color: a.delays.delayed ? '#a3202a' : undefined }}>{a.delays.delayed}</strong>
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
              <p className="muted"><CheckCircle2 size={13} /> Nothing is running late.</p>
            )}
          </Panel>

          <Panel title="Customer-wise production" subtitle="Metres ordered, produced and dispatched per customer" className="span-2">
            <div className="chart-box" style={{ height: Math.max(220, a.customers.length * 58) }}>
              <ResponsiveContainer>
                <BarChart data={a.customers} layout="vertical" barGap={2} margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#eceef1" horizontal={false} />
                  <XAxis type="number" tick={axis} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="buyer" tick={axis} tickLine={false} axisLine={false} width={118} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${number(Number(v))} m`, String(n)]} cursor={{ fill: '#f3f4f6' }} />
                  <Legend iconType="square" formatter={(v) => <span style={{ color: '#1f2227' }}>{v}</span>} />
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
