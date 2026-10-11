// The hero's living threads. Each thread enters from a different edge of the screen, sweeps
// through a weaving zone where the threads cross over and under each other, and leaves by
// another edge. Threads draw themselves in (a bright "shuttle" at the tip, leaving a short
// comet trail), then keep breathing: a slow layered sway, a light that travels along the lime
// threads, and a gentle pull towards the pointer. Small lint particles drift up through the weave.
//
// Pure canvas: no library, devicePixelRatio-aware, paused while the tab is hidden or off screen,
// and a single still frame when the visitor prefers reduced motion.

type Point = { x: number; y: number };
type Edge = 'left' | 'right' | 'top' | 'bottom';

interface Thread {
  anchors: Point[];      // resting path in unit space (0..1 of the canvas); first/last are off screen
  phases: number[];      // per-anchor sway phase
  speed: number;         // sway speed
  amplitude: number;     // sway size (unit space)
  colour: string;
  highlight: string;
  width: number;
  hot: boolean;          // the lime threads: glow + travelling light
  anchor: boolean;       // the one thread pinned under the headline word
  delay: number;         // seconds before it starts drawing in
  drawTime: number;      // seconds to draw in
  points: Point[];       // scratch buffer for the current frame
}

interface Particle { x: number; y: number; r: number; vy: number; vx: number; twinkle: number; alpha: number }

export interface ThreadSceneOptions {
  background: string;
  reducedMotion: boolean;
  /** 0..1, where the weave sits horizontally (the hero copy sits on the left). */
  weaveX?: number;
  /** Fade the canvas behind the copy so text stays readable: from the left or from the top. */
  scrim?: 'left' | 'top' | 'none';
  /** Fewer threads that all gather into one point on the right (the closing band). */
  converge?: boolean;
  seed?: number;
}

// Deterministic pseudo-random so every visit shows the same composition.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Colour by depth: far threads are dark green, near ones brighter; a few are lime and "hot".
const DEPTHS = [
  { colour: '#123b2b', highlight: '#2c6a50', width: 2.2 },
  { colour: '#17573d', highlight: '#3b8f6a', width: 3.0 },
  { colour: '#1f7a52', highlight: '#5ab98e', width: 3.6 },
  { colour: '#2aa06a', highlight: '#7ddc6e', width: 4.4 },
  { colour: '#3fbf7e', highlight: '#a6ecb9', width: 5.0 },
  { colour: '#b9b4a4', highlight: '#efece2', width: 1.8 }, // one pale cotton thread
];
const HOT = { colour: '#c8f135', highlight: '#eeffb0', width: 5.6 };

function entryPoint(edge: Edge, random: () => number): Point {
  const t = 0.08 + random() * 0.84;
  switch (edge) {
    case 'left': return { x: -0.08, y: t };
    case 'right': return { x: 1.08, y: t };
    case 'top': return { x: t, y: -0.1 };
    default: return { x: t, y: 1.1 };
  }
}

function makeThreads(random: () => number, count: number, weaveX: number, converge: boolean): Thread[] {
  const edgeWeights: Edge[] = ['right', 'right', 'right', 'right', 'left', 'left', 'left', 'top', 'top', 'bottom', 'bottom'];
  const hotEvery = Math.max(3, Math.floor(count / 3));
  return Array.from({ length: count }, (_, i) => {
    const edge = converge ? (['left', 'top', 'bottom'] as Edge[])[i % 3] : edgeWeights[Math.floor(random() * edgeWeights.length)];
    const opposite: Record<Edge, Edge> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
    const adjacent: Edge[] = edge === 'left' || edge === 'right' ? ['top', 'bottom'] : ['left', 'right'];
    const exitEdge = converge ? 'right' : random() < 0.6 ? opposite[edge] : adjacent[Math.floor(random() * 2)];
    const enter = entryPoint(edge, random);
    const exit = converge ? { x: 1.08, y: 0.5 + (random() - 0.5) * 0.06 } : entryPoint(exitEdge, random);
    // Two or three waypoints inside the weaving zone, so threads cross each other there.
    const n = 2 + Math.floor(random() * 2);
    const middle = Array.from({ length: n }, (_, k) => ({
      x: weaveX + (random() - 0.5) * (converge ? 0.5 : 0.36) + (k - (n - 1) / 2) * 0.08,
      y: converge ? 0.5 + (random() - 0.5) * 0.7 * (1 - k / n) : 0.16 + random() * 0.68,
    }));
    const hot = (i + 1) % hotEvery === 0;
    const depth = DEPTHS[Math.floor(random() * DEPTHS.length)];
    const style = hot ? HOT : depth;
    const anchors = [enter, ...middle, exit];
    return {
      anchors,
      phases: anchors.map(() => random() * Math.PI * 2),
      speed: 0.1 + random() * 0.18,
      amplitude: 0.014 + random() * 0.028,
      colour: style.colour,
      highlight: style.highlight,
      width: style.width * (0.85 + random() * 0.3),
      hot,
      anchor: false,
      // Far, dim threads arrive first; the lime ones come last.
      delay: 0.15 + (hot ? 1.4 : random() * 1.1) + i * 0.05,
      drawTime: 1.4 + random() * 1.2,
      points: [],
    };
  });
}

// Catmull-Rom through the anchors, sampled into a polyline (so we can draw it partially).
function sample(points: Point[], steps: number, into: Point[]): Point[] {
  into.length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      into.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  into.push(points[points.length - 1]);
  return into;
}

export interface ThreadScene {
  destroy(): void;
  /** Pin the lime anchor thread under a rectangle (viewport coordinates), e.g. the headline word. */
  setAnchor(rect: DOMRect | null): void;
  /** Stop or restart the animation (used when the canvas scrolls out of view). */
  setActive(active: boolean): void;
}

export function createThreadScene(canvas: HTMLCanvasElement, options: ThreadSceneOptions): ThreadScene {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy() {}, setAnchor() {}, setActive() {} };
  const random = rng(options.seed ?? 7);
  const weaveX = options.weaveX ?? 0.66;
  const lowTier = (navigator.hardwareConcurrency ?? 8) <= 4;

  let width = 0, height = 0, dpr = 1;
  let threads: Thread[] = [];
  let particles: Particle[] = [];
  let frame = 0;
  let active = true;
  let start = performance.now();
  let pausedAt: number | null = null;
  let anchorRect: DOMRect | null = null;
  const pointer = { x: -1, y: -1, tx: -1, ty: -1 };
  let steps = lowTier ? 12 : 16;
  // Lite mode: no glow or highlight passes, fewer points. Chosen up front on small devices and
  // switched on automatically when the first second of frames is slow (software rendering).
  let lite = lowTier;
  let slowFrames = 0, measured = 0;

  function build() {
    const count = options.converge ? 9 : width >= 1100 ? (lite ? 12 : 16) : width >= 600 ? (lite ? 10 : 13) : 10;
    threads = makeThreads(random, count, width < 600 && !options.converge ? 0.5 : weaveX, Boolean(options.converge));
    // The first lime thread is the anchor: it is pinned to pass just under the headline word.
    const anchor = threads.find((t) => t.hot);
    if (anchor) {
      anchor.anchor = true;
      while (anchor.anchors.length < 5) { anchor.anchors.splice(1, 0, { ...anchor.anchors[1] }); anchor.phases.splice(1, 0, 0); }
    }
    particles = Array.from({ length: lite || width < 600 ? 22 : 44 }, () => ({
      x: random(), y: random(), r: 0.6 + random() * 1.5, vy: 0.004 + random() * 0.01, vx: (random() - 0.5) * 0.003, twinkle: random() * Math.PI * 2, alpha: 0.2 + random() * 0.45,
    }));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    // 1.5× is plenty for soft strokes and keeps the fill rate down on big screens; lite mode draws at 1×.
    dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5);
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    const rebuild = !threads.length || (w >= 600) !== (width >= 600) || (w >= 1100) !== (width >= 1100);
    width = w; height = h;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (rebuild) build();
    if (options.reducedMotion || !active) draw(Number.POSITIVE_INFINITY, 0);
  }

  // Resting path, swayed by time and bent slightly towards the pointer; the anchor thread
  // has one waypoint dragged under the headline word.
  function pathAt(thread: Thread, time: number): Point[] {
    const t = Number.isFinite(time) ? time : 4;
    const live = thread.anchors.map((a, i) => {
      const inner = i > 0 && i < thread.anchors.length - 1;
      const sway = inner ? thread.amplitude : thread.amplitude * 0.2;
      let x = a.x + Math.sin(t * thread.speed * 2 + thread.phases[i]) * sway;
      let y = a.y + Math.cos(t * thread.speed * 1.6 + thread.phases[i] * 1.3) * sway * 1.4;
      if (thread.anchor && anchorRect && (i === 1 || i === 2)) {
        const c = canvas.getBoundingClientRect();
        x = (anchorRect.left + anchorRect.width * (i === 1 ? -0.08 : 1.08) - c.left) / width;
        y = (anchorRect.bottom + 4 - c.top) / height + Math.sin(t * 0.8 + i) * 0.003;
      }
      if (inner && pointer.x >= 0 && !thread.anchor) {
        const dx = pointer.x - x, dy = pointer.y - y;
        const d = Math.hypot(dx, dy);
        if (d < 0.26) { const pull = (0.26 - d) * 0.24; x += dx * pull; y += dy * pull; }
      }
      return { x: x * width, y: y * height };
    });
    return sample(live, steps, thread.points);
  }

  function trace(points: Point[], count: number) {
    ctx!.beginPath();
    ctx!.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < count; i++) ctx!.lineTo(points[i].x, points[i].y);
  }

  function drawThread(thread: Thread, t: number, elapsed: number) {
    const points = pathAt(thread, t);
    const progress = Number.isFinite(t) ? Math.min(1, Math.max(0, (t - thread.delay) / thread.drawTime)) : 1;
    if (progress <= 0) return;
    const eased = 1 - Math.pow(1 - progress, 4);
    const count = Math.max(2, Math.floor(points.length * eased));
    ctx!.lineCap = 'round';
    ctx!.lineJoin = 'round';
    ctx!.setLineDash([]);
    // Threads fade in from the edges, so they feel like they come from outside the screen.
    const first = points[0], last = points[points.length - 1];
    const body = ctx!.createLinearGradient(first.x, first.y, last.x, last.y);
    body.addColorStop(0, thread.colour + '55');
    body.addColorStop(0.3, thread.colour);
    body.addColorStop(0.7, thread.colour);
    body.addColorStop(1, thread.colour + '55');
    // A gap in the background colour under each thread: where threads cross, the later one
    // visibly passes over the earlier one, which is what makes the weave read as woven.
    ctx!.globalCompositeOperation = 'source-over';
    ctx!.strokeStyle = options.background;
    ctx!.lineWidth = thread.width + 5;
    ctx!.globalAlpha = 0.9;
    trace(points, count); ctx!.stroke();
    // Soft glow on the lime threads (additive, far cheaper than shadowBlur).
    if (thread.hot && !lite) {
      ctx!.globalCompositeOperation = 'lighter';
      ctx!.strokeStyle = thread.colour;
      ctx!.globalAlpha = 0.1;
      ctx!.lineWidth = thread.width * 3.2;
      trace(points, count); ctx!.stroke();
      ctx!.globalCompositeOperation = 'source-over';
    }
    ctx!.globalAlpha = 1;
    ctx!.strokeStyle = body;
    ctx!.lineWidth = thread.width;
    trace(points, count); ctx!.stroke();
    // A thin highlight along one side gives it the roundness of yarn.
    if (!lite) {
      ctx!.globalAlpha = 0.5;
      ctx!.strokeStyle = thread.highlight;
      ctx!.lineWidth = Math.max(0.6, thread.width * 0.3);
      ctx!.save();
      ctx!.translate(-thread.width * 0.2, -thread.width * 0.24);
      trace(points, count); ctx!.stroke();
      ctx!.restore();
      ctx!.globalAlpha = 1;
    }
    if (progress < 1) {
      // The shuttle: a bright tip while the thread is still drawing in.
      const tip = points[count - 1];
      ctx!.fillStyle = thread.highlight;
      ctx!.globalAlpha = 0.95;
      ctx!.beginPath(); ctx!.arc(tip.x, tip.y, thread.width * 0.95 + 1, 0, Math.PI * 2); ctx!.fill();
      ctx!.globalAlpha = 1;
    } else if (thread.hot && Number.isFinite(t)) {
      // After it has drawn in, a light travels along the lime thread, like yarn being pulled.
      const total = count * 6;
      const seg = total * 0.12;
      ctx!.setLineDash([seg, total]);
      ctx!.lineDashOffset = -((elapsed * 90 + thread.phases[0] * 200) % (total + seg));
      ctx!.globalCompositeOperation = 'lighter';
      ctx!.strokeStyle = thread.highlight;
      ctx!.globalAlpha = 0.7;
      ctx!.lineWidth = thread.width * 0.9;
      trace(points, count); ctx!.stroke();
      ctx!.setLineDash([]);
      ctx!.globalCompositeOperation = 'source-over';
      ctx!.globalAlpha = 1;
    }
  }

  function drawParticles(t: number) {
    for (const p of particles) {
      ctx!.globalAlpha = p.alpha * (0.6 + 0.4 * Math.sin(t * 1.3 + p.twinkle));
      ctx!.fillStyle = p.r > 1.5 ? '#c8f135' : '#e9f5e4';
      ctx!.beginPath(); ctx!.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2); ctx!.fill();
    }
    ctx!.globalAlpha = 1;
  }

  // Dim the canvas behind the copy so the headline stays readable; the lime threads are drawn
  // after it, so they still cross the text zone at full brightness.
  function drawScrim() {
    if (!options.scrim || options.scrim === 'none') return;
    const mobile = width < 600;
    let g: CanvasGradient;
    if (options.scrim === 'left' && !mobile) {
      g = ctx!.createLinearGradient(0, 0, width * 0.74, 0);
      g.addColorStop(0, options.background + 'ec');
      g.addColorStop(0.6, options.background + 'b8');
      g.addColorStop(1, options.background + '00');
    } else if (mobile) {
      // Phone copy sits at the bottom of the hero.
      g = ctx!.createLinearGradient(0, height * 0.1, 0, height);
      g.addColorStop(0, options.background + '00');
      g.addColorStop(0.22, options.background + 'b0');
      g.addColorStop(0.5, options.background + 'd8');
      g.addColorStop(1, options.background + 'f0');
    } else {
      g = ctx!.createLinearGradient(0, 0, 0, height * 0.58);
      g.addColorStop(0, options.background + 'd9');
      g.addColorStop(1, options.background + '00');
    }
    ctx!.fillStyle = g;
    ctx!.fillRect(0, 0, width, height);
  }

  function step(t: number, dt: number) {
    for (const p of particles) {
      p.y -= p.vy * dt; p.x += p.vx * dt + Math.sin(t + p.twinkle) * 0.0004;
      if (p.y < -0.02) { p.y = 1.02; p.x = random(); }
      if (p.x < -0.02) p.x = 1.02; else if (p.x > 1.02) p.x = -0.02;
    }
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
  }

  function draw(t: number, elapsed: number) {
    if (Number.isFinite(t) && t < 3.2 && !lite) {
      // While the threads draw in, the frame fades instead of clearing, so the shuttles leave trails.
      ctx!.globalCompositeOperation = 'source-over';
      ctx!.fillStyle = options.background + 'cc';
      ctx!.fillRect(0, 0, width, height);
    } else {
      ctx!.clearRect(0, 0, width, height);
    }
    drawParticles(Number.isFinite(t) ? t : 0);
    const pinned = Boolean(anchorRect);
    for (const thread of threads) if (!(thread.anchor && pinned)) drawThread(thread, t, elapsed);
    drawScrim();
    if (pinned) for (const thread of threads) if (thread.anchor) drawThread(thread, t, elapsed);
  }

  let last = start;
  function loop(now: number) {
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    if (!lite && measured < 90) {
      measured += 1;
      if (now - last > 28) slowFrames += 1;
      if (measured === 90 && slowFrames > 30) { lite = true; steps = 12; threads = []; resize(); }
    }
    last = now;
    step(t, dt);
    draw(t, t);
    frame = requestAnimationFrame(loop);
  }

  function pause() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; pausedAt = performance.now(); }
  }
  function resume() {
    if (frame || options.reducedMotion || !active || document.hidden) return;
    if (pausedAt) { start += performance.now() - pausedAt; pausedAt = null; }
    last = performance.now();
    frame = requestAnimationFrame(loop);
  }
  const onVisibility = () => (document.hidden ? pause() : resume());
  const onPointer = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.tx = (e.clientX - rect.left) / rect.width;
    pointer.ty = (e.clientY - rect.top) / rect.height;
    if (pointer.x < 0) { pointer.x = pointer.tx; pointer.y = pointer.ty; }
  };
  const onLeave = () => { pointer.tx = -1; pointer.ty = -1; pointer.x = -1; pointer.y = -1; };

  const host = canvas.parentElement;
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  if (!options.reducedMotion) {
    resume();
    document.addEventListener('visibilitychange', onVisibility);
    if (window.matchMedia('(hover: hover)').matches) {
      host?.addEventListener('pointermove', onPointer);
      host?.addEventListener('pointerleave', onLeave);
    }
  }

  return {
    destroy() {
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      host?.removeEventListener('pointermove', onPointer);
      host?.removeEventListener('pointerleave', onLeave);
    },
    setAnchor(rect) { anchorRect = rect; },
    setActive(next) {
      active = next;
      if (next) resume(); else pause();
    },
  };
}
