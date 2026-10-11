import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, Factory, Users, Wallet, TriangleAlert, ShieldCheck, Play } from 'lucide-react';
import { factoryToday, type ShiftReport } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { Panel, Loading, ErrorState, Badge, Empty } from '../../components/shared/common';
import { BarList, axis, series, stageColors, tooltipStyle } from '../../components/shared/Charts';
import { Button } from '../../components/ui/button';
import { label, money, number } from '../../lib/utils';

const time = (v: string) => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const shiftDay = (offset: number) => {
  const d = new Date(`${factoryToday()}T12:00:00+05:30`);
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
};

// What happened in every shift of a day: people, output, machines, breakdowns, quality, wages,
// and a timeline. The week chart shows metres made per shift for the seven days up to that day.
export function ShiftReports() {
  // Before the first shift of the day, the shifts still running belong to yesterday.
  const [day, setDay] = useState(factoryToday(new Date(Date.now() - 6 * 3600000)));
  const query = useData<ShiftReport>(`/shifts/report?date=${day}`);

  return (
    <>
      <div className="production-toolbar">
        <div className="segmented-control">
          {[['Today', 0], ['Yesterday', -1], ['2 days ago', -2]].map(([name, offset]) => (
            <button key={name} className={day === shiftDay(Number(offset)) ? 'active' : ''} onClick={() => setDay(shiftDay(Number(offset)))}>{name}</button>
          ))}
        </div>
        <label className="date-button">
          <CalendarDays size={16} />
          <input type="date" aria-label="Shift date" value={day} max={factoryToday()} onChange={(e) => setDay(e.target.value || factoryToday())} />
        </label>
      </div>

      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <Panel title="Metres made per shift" subtitle="The seven days up to the chosen day">
            <div className="chart-box" style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={query.data.week} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#eceef1" />
                  <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={axis} axisLine={false} tickLine={false} width={48} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${number(Number(v))} m`, String(n)]} cursor={{ fill: '#f3f4f6' }} />
                  <Legend iconType="square" formatter={(v) => <span style={{ color: '#1f2227' }}>{v}</span>} />
                  {query.data.shiftNames.map((name, i) => (
                    <Bar key={name} dataKey={name} stackId="s" fill={series[i % series.length]} stroke="#ffffff" strokeWidth={2} maxBarSize={36} radius={i === query.data.shiftNames.length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="shift-grid mt-5">
            {query.data.shifts.map((s) => (
              <Panel key={s.id}>
                <div className="shift-card-head">
                  <div>
                    <h2 style={{ margin: 0 }}>{s.name}</h2>
                    <span className="muted">{time(s.start)} – {time(s.end)}</span>
                  </div>
                  <Badge value={s.state === 'CURRENT' ? 'RUNNING' : s.state === 'COMPLETED' ? 'COMPLETED' : 'PLANNED'}>{s.state === 'CURRENT' ? 'On now' : label(s.state)}</Badge>
                </div>

                <div className="shift-stats">
                  <div><strong>{number(s.output)} m</strong><span><Factory size={12} /> made</span></div>
                  <div><strong>{s.present.length}</strong><span><Users size={12} /> worked{s.absent ? ` · ${s.absent} absent` : ''}</span></div>
                  <div><strong>{money(s.wages)}</strong><span><Wallet size={12} /> wages</span></div>
                  <div><strong>{s.started} / {s.finished}</strong><span><Play size={12} /> jobs started / done</span></div>
                  <div><strong>{s.breakdowns.length}</strong><span><TriangleAlert size={12} /> breakdowns</span></div>
                  <div><strong>{s.inspections.passed}/{s.inspections.passed + s.inspections.rework + s.inspections.rejected}</strong><span><ShieldCheck size={12} /> rolls passed</span></div>
                </div>

                {s.output > 0 && (
                  <section className="shift-section">
                    <h3>Output by stage</h3>
                    <BarList rows={s.byStage.map((b) => ({ label: label(b.stage), value: b.output, color: stageColors[b.stage] }))} format={(v) => `${number(v)} m`} />
                  </section>
                )}

                {s.byMachine.length > 0 && (
                  <section className="shift-section">
                    <h3>Machines</h3>
                    <div className="people-list">
                      {s.byMachine.map((m) => <span key={m.code}>{m.code} · {number(m.output)} m · {number(m.hours, 1)} h</span>)}
                    </div>
                  </section>
                )}

                <section className="shift-section">
                  <h3>Who worked</h3>
                  {s.present.length ? (
                    <div className="people-list">
                      {s.present.map((p) => (
                        <span key={p.worker} title={p.designation}>
                          {p.worker} · {p.checkInAt ? time(p.checkInAt) : '—'}–{p.checkOutAt ? time(p.checkOutAt) : 'still in'}{p.overtime ? ` · +${p.overtime} h OT` : ''}
                        </span>
                      ))}
                    </div>
                  ) : <p className="muted" style={{ margin: 0 }}>{s.state === 'UPCOMING' ? 'Not started yet.' : 'Nobody was checked in.'}</p>}
                </section>

                {s.breakdowns.length > 0 && (
                  <section className="shift-section">
                    <h3>Breakdowns</h3>
                    <div className="record-list">
                      {s.breakdowns.map((b) => (
                        <div className="record" key={b.machine + b.at}>
                          <div><strong>{b.machine}</strong><p>{b.reason}</p></div>
                          <span className="record-meta">{time(b.at)} · {b.resolved ? 'repaired' : 'still down'}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="shift-section">
                  <h3>What happened</h3>
                  {s.events.length ? (
                    <ul className="timeline">
                      {s.events.map((e) => (
                        <li key={e.at + e.text}><time>{time(e.at)} · {e.who}</time>{e.text}</li>
                      ))}
                    </ul>
                  ) : <p className="muted" style={{ margin: 0 }}>No recorded activity.</p>}
                </section>
              </Panel>
            ))}
            {query.data.shifts.length === 0 && <Empty title="No shifts set up" description="An administrator can add shifts on this page." />}
          </div>
          <p className="chart-note">Night shifts that run past midnight are shown under the day they started.</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Refresh</Button>
        </>
      )}
    </>
  );
}
