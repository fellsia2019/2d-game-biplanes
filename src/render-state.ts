import { WIDTH } from '../shared/data';
import type { Battle } from '../shared/simulation';

const DELAY = .1;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function xBetween(a: number, b: number, t: number, wrap: boolean) {
  let delta = b - a;
  if (wrap && Math.abs(delta) > WIDTH / 2) delta -= Math.sign(delta) * WIDTH;
  const x = a + delta * t;
  return wrap ? (x + WIDTH) % WIDTH : x;
}
function frameBetween(a: Battle, b: Battle, t: number): Battle {
  const planes = new Map(b.planes.map(p => [p.id, p]));
  const obstacles = new Map(b.obstacles.map(o => [o.id, o]));
  const bullets = new Map(b.bullets.map(p => [p.id, p]));
  const pickups = new Map((b.pickups ?? []).map(p => [p.id, p]));
  const bombers = new Map((b.bombers ?? []).map(p => [p.id, p]));
  return { ...a, time: mix(a.time, b.time, t), totalDistance: mix(a.totalDistance, b.totalDistance, t),
    planes: a.planes.map(p => {
      const q = planes.get(p.id); if (!q || p.health <= 0 || q.health <= 0) return p;
      const angle = Math.atan2(Math.sin(q.angle - p.angle), Math.cos(q.angle - p.angle));
      return { ...p, x: xBetween(p.x, q.x, t, a.phase !== 'flight'), y: mix(p.y, q.y, t), angle: p.angle + angle * t };
    }),
    obstacles: a.obstacles.map(o => { const q = obstacles.get(o.id); return q ? { ...o, x: mix(o.x, q.x, t), y: mix(o.y, q.y, t), fire: mix(o.fire, q.fire, t) } : o; }),
    bullets: a.bullets.map(p => { const q = bullets.get(p.id); return q ? { ...p, x: mix(p.x, q.x, t), y: mix(p.y, q.y, t) } : p; }),
    pickups: a.pickups?.map(p => { const q = pickups.get(p.id); return q ? {...p, x:mix(p.x,q.x,t), y:mix(p.y,q.y,t)} : p; }),
    bombers: a.bombers?.map(p => { const q = bombers.get(p.id); return q ? {...p, x:mix(p.x,q.x,t), warning:mix(p.warning,q.warning,t)} : p; }),
  };
}

/** One delayed, monotonic render clock for every entity. Server state stays untouched. */
export class RenderBuffer {
  private frames: Battle[] = []; private arrival = 0; private clock = 0; private now = 0;
  push(state: Battle, now: number) {
    const previous = this.frames.at(-1);
    if (!previous || previous.id !== state.id || previous.paused !== state.paused || previous.phase !== state.phase) {
      this.frames = [state]; this.clock = state.time - DELAY; this.now = now;
    } else if (state.time > previous.time) {
      this.frames.push(state); if (this.frames.length > 12) this.frames.shift();
    } else if (state.time === previous.time) this.frames[this.frames.length - 1] = state;
    else return;
    this.arrival = now;
  }
  sample(now: number): Battle | undefined {
    const latest = this.frames.at(-1); if (!latest) return;
    if (latest.paused || latest.phase === 'ended') { this.now = now; return latest; }
    const elapsed = Math.max(0, Math.min(.1, (now - this.now) / 1000)); this.now = now;
    const target = latest.time + Math.min(DELAY, Math.max(0, (now - this.arrival) / 1000)) - DELAY;
    const drift = target - this.clock;
    this.clock += elapsed * Math.max(.9, Math.min(1.1, 1 + drift * 2));
    if (drift > .3) this.clock = target;
    // Input-driven movement can stop or reverse between packets. Extrapolating
    // the old velocity overshoots that stop, then snaps back when it arrives.
    // Keep the delayed clock on confirmed motion; one late packet may exhaust
    // the buffer briefly, but cannot invent a position requiring a rewind.
    this.clock = Math.min(this.clock, latest.time);
    if (this.clock <= this.frames[0].time) return this.frames[0];
    for (let i = 1; i < this.frames.length; i++) {
      const a = this.frames[i - 1], b = this.frames[i];
      if (this.clock < b.time) return frameBetween(a, b, (this.clock - a.time) / (b.time - a.time));
    }
    return latest;
  }
}
