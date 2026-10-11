import { useEffect, useRef, useState } from 'react';
import { Activity, Factory, ShieldCheck, Wallet, Bell, Search, Layers, Truck, ShoppingBag, Users } from 'lucide-react';

// A living preview of the LoomOS dashboard, drawn with HTML and SVG (no screenshot). When it
// scrolls into view the numbers count up, the bars grow, the donut draws and the rows slide in.

const KPIS = [
  { label: 'Running now', value: 3, unit: 'jobs', meta: '8,540 m produced today', icon: Activity, accent: true },
  { label: 'Machines', value: 6, unit: 'in use', meta: '3 running · 2 idle · 1 down', icon: Factory },
  { label: 'Awaiting inspection', value: 13, unit: 'rolls', meta: '1 rework · 2 rejected', icon: ShieldCheck },
  { label: 'Profit this month', value: 2.1, unit: 'L', prefix: '₹', meta: '₹11.9 L sales − ₹9.8 L spent', icon: Wallet, accent: true, decimals: 1 },
];
const WEEK = [1800, 3100, 1500, 1600, 1300, 2600, 8540];
const JOBS = [
  { batch: 'WO-2001', stage: 'Spinning', fabric: 'Premium cotton poplin', who: 'SP-01 · Anjali', status: 'Running', tone: 'green' },
  { batch: 'WO-2002', stage: 'Weaving', fabric: 'Cotton twill', who: 'LM-01 · Rajesh', status: 'Running', tone: 'green' },
  { batch: 'WO-2003', stage: 'Dyeing', fabric: 'Linen blend', who: 'DY-01 · Priya', status: 'Running', tone: 'green' },
  { batch: 'WO-2001', stage: 'Weaving', fabric: 'Premium cotton poplin', who: 'waiting for spinning', status: 'Planned', tone: 'grey' },
  { batch: 'WO-1999', stage: 'Quality', fabric: 'Raw cotton fabric', who: '2 rolls to inspect', status: 'Checking', tone: 'amber' },
];
const MACHINES = [
  { name: 'Running', value: 3, colour: '#c8f135' },
  { name: 'Idle', value: 2, colour: '#4d5a52' },
  { name: 'Breakdown', value: 1, colour: '#ff7a6b' },
];

function useInView<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, seen };
}

function CountUp({ to, decimals = 0, prefix = '', run }: { to: number; decimals?: number; prefix?: string; run: boolean }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setValue(to); return; }
    const startAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - startAt) / 1400);
      setValue(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, to]);
  return <>{prefix}{value.toFixed(decimals)}</>;
}

export function DashboardMock() {
  const { ref, seen } = useInView<HTMLDivElement>(0.25);
  const max = Math.max(...WEEK);
  const total = MACHINES.reduce((s, m) => s + m.value, 0);
  const circumference = 2 * Math.PI * 42;
  let offset = 0;

  return (
    <div ref={ref} className={`mock ${seen ? 'is-live' : ''}`} aria-label="Preview of the LoomOS dashboard" role="img">
      <div className="mock-chrome">
        <span className="mock-dots"><i /><i /><i /></span>
        <span className="mock-url">loomos.app / overview</span>
      </div>
      <div className="mock-body">
        <aside className="mock-side">
          <div className="mock-brand">Loom<b>OS</b><em>.</em></div>
          {[['Overview', Layers, true], ['Orders', ShoppingBag, false], ['Production', Factory, false], ['Quality', ShieldCheck, false], ['Dispatch', Truck, false], ['Workers & shifts', Users, false], ['Accounts', Wallet, false]].map(([name, Icon, active]) => {
            const I = Icon as typeof Layers;
            return <span key={String(name)} className={active ? 'active' : ''}><I size={12} />{String(name)}</span>;
          })}
        </aside>
        <div className="mock-main">
          <div className="mock-top">
            <span><Search size={11} /> Search anything…</span>
            <span className="mock-new">+ New</span>
            <span className="mock-bell"><Bell size={11} /><b>3</b></span>
          </div>
          <div className="mock-greet">Good morning, Aditya <small>3 jobs running across 11 open orders · Oct: profit ₹2,10,829</small></div>
          <div className="mock-kpis">
            {KPIS.map((k) => (
              <div key={k.label} className={`mock-kpi ${k.accent ? 'accent' : ''}`}>
                <span><em>{k.label}</em><k.icon size={12} /></span>
                <strong><CountUp to={k.value} decimals={k.decimals} prefix={k.prefix} run={seen} /> <small>{k.unit}</small></strong>
                <small>{k.meta}</small>
              </div>
            ))}
          </div>
          <div className="mock-grid">
            <div className="mock-card mock-jobs">
              <header>Jobs needing action <span>Production floor →</span></header>
              {JOBS.map((j, i) => (
                <div key={j.batch + j.stage} className="mock-row" style={{ transitionDelay: `${300 + i * 110}ms` }}>
                  <div><b>{j.batch}</b> · {j.stage} · {j.fabric}<small>{j.who}</small></div>
                  <i className={`mock-badge ${j.tone}`}>{j.status}</i>
                </div>
              ))}
            </div>
            <div className="mock-card mock-chart">
              <header>Production this week <span>metres per day</span></header>
              <div className="mock-bars">
                {WEEK.map((v, i) => (
                  <span key={i} style={{ height: `${(v / max) * 100}%`, transitionDelay: `${200 + i * 90}ms` }} className={i === WEEK.length - 1 ? 'today' : ''} />
                ))}
              </div>
              <div className="mock-axis">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
            </div>
            <div className="mock-card mock-donut">
              <header>Machines right now</header>
              <div className="mock-donut-body">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="#1d2a24" strokeWidth="12" />
                  {MACHINES.map((m) => {
                    const len = (m.value / total) * circumference;
                    const dash = <circle key={m.name} cx="50" cy="50" r="42" fill="none" stroke={m.colour} strokeWidth="12" strokeDasharray={`${len} ${circumference}`} strokeDashoffset={-offset} style={{ transitionDelay: `${400 + offset}ms` }} className="mock-arc" transform="rotate(-90 50 50)" />;
                    offset += len;
                    return dash;
                  })}
                  <text x="50" y="47" textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff">{total}</text>
                  <text x="50" y="60" textAnchor="middle" fontSize="7" fill="#9aa69f">machines</text>
                </svg>
                <ul>{MACHINES.map((m) => <li key={m.name}><i style={{ background: m.colour }} />{m.name}<b>{m.value}</b></li>)}</ul>
              </div>
            </div>
            <div className="mock-card mock-alerts">
              <header>Needs attention <span>3 items</span></header>
              {['LM-02 broke down · belt snapped', 'Linen blend yarn running low · 502 kg', 'SO-2026-1003 · delivery risk'].map((a, i) => (
                <div key={a} className="mock-alert" style={{ transitionDelay: `${500 + i * 120}ms` }}>{a}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
