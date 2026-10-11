import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, Check, ChevronRight, Factory, Layers, LayoutDashboard, Package, Pause, Play, ShieldCheck, ShoppingBag, Truck, Users, Wallet, X } from 'lucide-react';
import './hero-entry.css';

const INTRO_KEY = 'loomos:intro:v1';
const DURATION = 6200;
const modules = [
  { name: 'Orders', caption: 'Every commitment, clear.', icon: ShoppingBag, position: 'orders', dark: true },
  { name: 'Inventory', caption: 'The right material. Ready.', icon: Package, position: 'inventory', dark: false },
  { name: 'Production', caption: 'People, machines, progress.', icon: Factory, position: 'production', dark: true },
  { name: 'Quality', caption: 'Confidence in every roll.', icon: ShieldCheck, position: 'quality', dark: false },
  { name: 'Dispatch', caption: 'From your floor to their door.', icon: Truck, position: 'dispatch', dark: false },
  { name: 'Finance', caption: 'Every metre accounted for.', icon: Wallet, position: 'finance', dark: true },
];

function shouldIntroduce() {
  if (window.location.pathname !== '/' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try { return window.sessionStorage.getItem(INTRO_KEY) !== 'seen'; } catch { return true; }
}

/** A once-per-tab entry sequence. Authentication and the actual CRM stay mounted underneath. */
export function HeroEntry({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(shouldIntroduce);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const application = useRef<HTMLDivElement>(null);
  const introduction = useRef<HTMLElement>(null);
  const shouldRestoreFocus = useRef(false);
  const stopped = paused || hidden;
  const phase = elapsed < 1800 ? 'connect' : elapsed < 4000 ? 'align' : elapsed < 5700 ? 'ready' : 'exit';

  const finish = useCallback(() => {
    try { window.sessionStorage.setItem(INTRO_KEY, 'seen'); } catch { /* Private browsers may disable storage. */ }
    shouldRestoreFocus.current = true;
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    introduction.current?.focus({ preventScroll: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onReduced = () => { if (reduced.matches) finish(); };
    const onVisibility = () => setHidden(document.hidden);
    reduced.addEventListener('change', onReduced);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.body.style.overflow = previousOverflow;
      reduced.removeEventListener('change', onReduced);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [visible, finish]);

  useEffect(() => {
    if (!visible || stopped) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      setElapsed(value => Math.min(DURATION, value + delta));
    }, 50);
    return () => window.clearInterval(timer);
  }, [visible, stopped]);

  useEffect(() => { if (visible && elapsed >= DURATION) finish(); }, [visible, elapsed, finish]);
  useEffect(() => {
    if (!visible && shouldRestoreFocus.current) {
      application.current?.focus({ preventScroll: true });
      shouldRestoreFocus.current = false;
    }
  }, [visible]);

  return <>
    <div ref={application} className="loom-entry-app" inert={visible} aria-hidden={visible || undefined} tabIndex={-1}>{children}</div>
    {visible && <section ref={introduction} role="region" aria-label="LoomOS introduction" tabIndex={-1}
      className={`loom-entry ${stopped ? 'loom-entry-paused' : ''}`} data-phase={phase}
      style={{ '--intro-progress': `${Math.min(100, elapsed / DURATION * 100)}%` } as CSSProperties}
      onKeyDown={event => {
        if (event.key === 'Escape') finish();
        if (event.key !== 'Tab') return;
        const buttons = introduction.current?.querySelectorAll<HTMLButtonElement>('button');
        if (!buttons?.length) return;
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === introduction.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div className="loom-entry-grain" aria-hidden="true"/>
      <header className="loom-entry-header">
        <span className="loom-entry-brand"><span><Layers size={22}/></span>Loom<span>OS</span><i/></span>
        <span className="loom-entry-header-caption">THE CONNECTED FACTORY</span>
        <div className="loom-entry-controls">
          <button className="loom-entry-pause" onClick={() => phase === 'exit' ? finish() : setPaused(value => !value)} aria-label={paused ? 'Resume animation' : 'Pause animation'}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
          <button className="loom-entry-skip" onClick={finish}>Skip introduction <ArrowRight size={15}/></button>
        </div>
      </header>
      <div className="loom-entry-main">
        <div className="loom-entry-copy">
          <span className="loom-entry-eyebrow"><span/>FROM FIRST THREAD TO FINAL DELIVERY</span>
          <h1>Your whole mill.<br/>One <em>clear</em> view.</h1>
          <p>Bring every order, every machine,<br className="loom-entry-desktop-break"/> and every person into one connected workspace.</p>
          <button className="loom-entry-open" onClick={finish}>Enter your workspace <ArrowRight size={18}/></button>
          <div className="loom-entry-caption"><span className="loom-entry-caption-line"/><span>Less chasing updates.<br/><strong>More moving forward.</strong></span></div>
        </div>
        <div className="loom-entry-scene" aria-hidden="true">
          <div className="loom-entry-halo"/>
          <span className="loom-entry-scene-label">ONE SYSTEM. EVERY PART OF YOUR MILL.</span>
          <div className="loom-entry-world">
            <div className="loom-entry-floor"/>
            <svg className="loom-entry-connections" viewBox="0 0 800 600" fill="none">
              <g className="loom-entry-wire"><path d="M165 150H330Q350 150 350 175V250H520Q540 250 540 230V130H630"/><path d="M165 150V380Q165 410 195 410H360Q390 410 390 380V270"/><path d="M620 140V460H410Q385 460 385 480V495H180"/><path d="M90 470H80Q60 470 60 450V320H690"/><path d="M450 70V285Q450 310 480 310H635V425"/></g>
              <g className="loom-entry-signal"><path d="M165 150H330Q350 150 350 175V250H520Q540 250 540 230V130H630"/><path d="M165 150V380Q165 410 195 410H360Q390 410 390 380V270"/><path d="M620 140V460H410Q385 460 385 480V495H180"/><path d="M90 470H80Q60 470 60 450V320H690"/></g>
              {[ [350,250], [165,320], [390,410], [620,310], [450,150] ].map(([cx,cy]) => <g key={`${cx}-${cy}`}><circle cx={cx} cy={cy} r="9" fill="#f8f8f7" stroke="#a7aaa7"/><circle cx={cx} cy={cy} r="3" fill="#323735"/></g>)}
            </svg>
            {modules.map(({ name, caption, icon: Icon, position, dark }, index) => <div key={name} className={`loom-entry-module loom-entry-module-${position} ${dark ? 'loom-entry-module-dark' : ''}`} style={{ '--module-delay': `${index * 90}ms` } as CSSProperties}>
              <div className="loom-entry-module-head"><span><Icon size={17}/></span><strong>{name}</strong><span className="loom-entry-module-dot"/></div>
              <div className="loom-entry-mini-chart">{[38,60,46,77,65,91,78].map((height,i) => <i key={i} style={{height:`${height-index*3}%`}}/>)}</div>
              <small>{caption}</small><span className="loom-entry-module-base"/>
            </div>)}
          </div>
          <WorkspacePreview/>
          <span className="loom-entry-scene-footnote">An illustrated preview of your connected workspace</span>
        </div>
      </div>
      <footer className="loom-entry-footer">
        <div className="loom-entry-sequence"><span className={phase==='connect'?'current':'complete'}><b>01</b> Connect</span><ChevronRight size={13}/><span className={phase==='align'?'current':phase==='ready'||phase==='exit'?'complete':''}><b>02</b> Align</span><ChevronRight size={13}/><span className={phase==='ready'||phase==='exit'?'current':''}><b>03</b> Get to work</span></div>
        <span className="loom-entry-status" role="status" aria-live="polite">{phase==='connect'?'Every part of your mill.':phase==='align'?'Working together.':'Your workspace, ready.'}</span>
        <span className="loom-entry-scroll"><ArrowDown size={14}/>Normal scrolling follows</span>
      </footer>
      <div className="loom-entry-progress" aria-hidden="true"><span/></div>
    </section>}
  </>;
}

function WorkspacePreview() {
  return <div className="loom-entry-preview">
    <div className="loom-entry-preview-chrome"><div><i/><i/><i/></div><span><Layers size={12}/>loomos / workspace</span><X size={12}/></div>
    <div className="loom-entry-preview-body">
      <div className="loom-entry-preview-nav"><span className="loom-entry-preview-logo"><Layers size={19}/></span>{[LayoutDashboard,ShoppingBag,Factory,ShieldCheck,Truck,Users,Wallet].map((Icon,i)=><span key={i} className={i===0?'active':''}><Icon size={16}/></span>)}</div>
      <div className="loom-entry-preview-content">
        <div className="loom-entry-preview-heading"><div><small>YOUR FACTORY, AT A GLANCE</small><h2>Everything. In sync.</h2></div><span><Check size={12}/>Connected</span></div>
        <div className="loom-entry-preview-metrics">{[['Orders','On track'],['Production','Moving'],['Dispatch','Ready']].map(([name,value])=><div key={name}><small>{name}</small><strong>{value}</strong><span><i/></span></div>)}</div>
        <div className="loom-entry-preview-charts"><div className="loom-entry-preview-output"><strong>Production overview</strong><svg viewBox="0 0 300 130" fill="none"><path d="M0 30H300M0 70H300M0 110H300" stroke="#e6e7e5" strokeDasharray="3 5"/><path d="M0 109C28 109 35 80 60 88S92 52 120 62S155 45 180 49S210 25 235 30S270 15 300 9V130H0Z" fill="#e9ece9"/><path d="M0 109C28 109 35 80 60 88S92 52 120 62S155 45 180 49S210 25 235 30S270 15 300 9" stroke="#242d27" strokeWidth="3"/></svg><div><span>Mon</span><span>Wed</span><span>Fri</span><span>Sun</span></div></div><div className="loom-entry-preview-quality"><strong>Quality</strong><div className="loom-entry-preview-donut"><ShieldCheck size={25}/></div><small>Checked. Tracked. Ready.</small></div></div>
        <div className="loom-entry-preview-row"><span><Package size={16}/>From yarn to delivery</span><span>One continuous flow <ArrowRight size={12}/></span></div>
      </div>
    </div>
    <span className="loom-entry-preview-shadow"/>
  </div>;
}
