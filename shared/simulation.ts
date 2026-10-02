import { WIDTH, HEIGHT, ZONE } from './data';
export interface Controls { turn: number; fire: boolean; boost: boolean }
export const IDLE: Controls = { turn: 0, fire: false, boost: false };
export interface Stats { model: string; hp: number; speed: number; turn: number; damage: number; boostDuration?: number; boostRecharge?: number; cooling?: number }
export interface Plane extends Stats { id: string; x: number; y: number; angle: number; health: number; heat: number; overheated: boolean; energy: number; shot: number; dead: number; shield: number; score: number; bot: boolean; ram: number; lastAttacker?: string }
export interface Bullet { id: number; owner: string; x: number; y: number; vx: number; vy: number; life: number; damage: number }
export interface Obstacle { id: number; kind: 'rock' | 'pvo' | 'fighter' | 'heavy'; x: number; y: number; radius: number; hp: number; fire: number; damage: number }
export interface Effect { id: number; kind: 'shot' | 'hit' | 'explosion' | 'reward' | 'level' | 'boss'; x: number; y: number; label?: string }
export interface Reward { player: string; silver: number; xp: number; kind: 'kill' | 'level' | 'duel'; win?: boolean }
export interface Battle {
  id: string; mode: 'duel' | 'pve'; planes: Plane[]; bullets: Bullet[]; obstacles: Obstacle[]; effects: Effect[];
  time: number; distance: number; totalDistance: number; level: number; phase: 'flight' | 'boss' | 'duel' | 'ended';
  spawn: number; seq: number; seed: number; paused: boolean; result: string; earned: Record<string, { silver: number; xp: number }>; activity: Record<string, number>;
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function random(s: Battle) { s.seed = (1664525 * s.seed + 1013904223) >>> 0; return s.seed / 4294967296; }
function fx(s: Battle, kind: Effect['kind'], x: number, y: number, label?: string) { s.effects.push({ id: ++s.seq, kind, x, y, label }); if (s.effects.length > 60) s.effects.shift(); }
export function makePlane(id: string, stats: Stats, bot = false, side = 0): Plane {
  return { ...stats, id, bot, x: side ? 980 : 220, y: side ? 300 : 330, angle: side ? Math.PI : 0, health: stats.hp, heat: 0, overheated: false, energy: 1, shot: 0, dead: 0, shield: 1.5, score: 0, ram: 0 };
}
export function createBattle(id: string, mode: Battle['mode'], planes: Plane[], level = 1): Battle {
  return { id, mode, planes, bullets: [], obstacles: [], effects: [], time: 0, distance: 0, totalDistance: 0, level, phase: mode === 'pve' ? 'flight' : 'duel', spawn: 1.8, seq: 0, seed: [...id].reduce((a,c) => ((a * 31) + c.charCodeAt(0)) >>> 0, 12345), paused: false, result: '', earned: Object.fromEntries(planes.map(p => [p.id, { silver: 0, xp: 0 }])), activity: Object.fromEntries(planes.map(p => [p.id, 0])) };
}
function botControls(s: Battle, p: Plane): Controls {
  const target = s.planes.find(x => x.id !== p.id && x.health > 0);
  if (!target) return IDLE;
  const dx = target.x - p.x, dy = target.y - p.y;
  const aim = Math.atan2(dy, dx) + Math.sin(s.time * 2 + p.x * .002) * .12;
  const desired = p.y > 490 ? -.8 : p.y < 130 ? .8 : aim;
  const d = angleDiff(desired, p.angle);
  return { turn: Math.abs(d) < .12 ? 0 : Math.sign(d), fire: Math.abs(d) < .28 && Math.hypot(dx, dy) < 900, boost: Math.hypot(dx, dy) > 450 && Math.abs(d) < .3 };
}
function award(s: Battle, rewards: Reward[], player: string, silver: number, xp: number, kind: Reward['kind'], win?: boolean) {
  if (!s.earned[player]) return;
  s.earned[player].silver += silver; s.earned[player].xp += xp;
  rewards.push({ player, silver, xp, kind, win });
}
function endDuel(s: Battle, rewards: Reward[]) {
  s.phase = 'ended';
  const high = Math.max(...s.planes.map(p => p.score));
  const tied = s.planes.every(p => p.score === high);
  for (const p of s.planes.filter(x => !x.bot && (s.activity[x.id] ?? 0) >= 5)) {
    const win = !tied && p.score === high;
    award(s, rewards, p.id, tied ? 90 : win ? 120 : 70, tied ? 50 : win ? 60 : 40, 'duel', win);
  }
  s.result = tied ? 'Ничья' : 'Дуэль завершена';
}
export function forfeitDuel(s: Battle, quitter: string): Reward[] {
  if (s.mode !== 'duel' || s.phase === 'ended') return [];
  const rewards: Reward[] = [];
  for (const p of s.planes) p.score = p.id === quitter ? Math.min(p.score, 2) : 3;
  endDuel(s, rewards); s.result = 'Противник покинул бой';
  return rewards;
}
function nextLevel(s: Battle, rewards: Reward[]) {
  const human = s.planes[0], def = ZONE[s.level - 1];
  award(s, rewards, human.id, 20 * def.tier, 10 * def.tier, 'level', true);
  if (s.level === 50) { s.phase = 'ended'; s.result = 'Рубеж пройден!'; return; }
  const fromBoss = s.phase === 'boss';
  s.level++; s.distance = 0; s.spawn = 2; s.phase = 'flight';
  if (fromBoss) s.bullets = [];
  s.planes = [human];
  if (fromBoss) { human.x = 220; human.angle = 0; human.shield = 2; }
  fx(s, 'level', WIDTH / 2, 150, 'УРОВЕНЬ ' + s.level);
}
export function beginBoss(s: Battle) {
  const def = ZONE[s.level - 1]; if (!def.boss) return;
  s.phase = 'boss'; s.obstacles = []; s.bullets = [];
  const human = s.planes[0]; human.x = 230; human.y = 330; human.angle = 0; human.health = human.hp; human.heat = 0; human.overheated = false; human.energy = 1; human.shield = 2;
  s.planes = [human, makePlane('boss', { model: 'enemy', hp: def.boss.hp, speed: 175 + s.level, turn: 2.1 + s.level * .007, damage: 7 + s.level * .14 }, true, 1)];
  fx(s, 'boss', WIDTH / 2, 190, def.boss.name);
}
export function stepBattle(s: Battle, inputs: Record<string, Controls>, dt: number): Reward[] {
  const rewards: Reward[] = [];
  if (s.paused || s.phase === 'ended') return rewards;
  s.time += dt;
  const flight = s.phase === 'flight', def = ZONE[s.level - 1];
  for (const p of s.planes) {
    p.ram = Math.max(0, p.ram - dt); p.shield = Math.max(0, p.shield - dt);
    if (p.health <= 0) {
      if (s.mode !== 'duel' || p.dead === 0) continue;
      p.dead -= dt;
      if (p.dead <= 0) { p.dead = 0; p.health = p.hp; p.x = p.bot || s.planes.indexOf(p) ? 980 : 220; p.y = 200 + random(s) * 200; p.angle = p.x > 600 ? Math.PI : 0; p.heat = 0; p.overheated = false; p.energy = 1; p.shield = 1.5; p.lastAttacker = undefined; }
      continue;
    }
    const c = p.bot ? botControls(s, p) : inputs[p.id] ?? IDLE;
    s.activity ??= {};
    if (!p.bot && (c.turn || c.fire || c.boost)) s.activity[p.id] = (s.activity[p.id] ?? 0) + dt;
    p.angle += clamp(c.turn, -1, 1) * p.turn * dt;
    p.angle = flight ? clamp(p.angle, -1.2, 1.2) : angleDiff(p.angle, 0);
    const boosting = c.boost && p.energy > .03;
    p.energy = clamp(p.energy + dt * (boosting ? -1 / (p.boostDuration ?? 2) : 1 / (p.boostRecharge ?? 6)), 0, 1);
    const speed = p.speed * (boosting ? 1.3 : 1);
    p.x += Math.cos(p.angle) * speed * dt - (flight ? def.scroll * dt : 0);
    p.y += Math.sin(p.angle) * speed * dt;
    if (flight) p.x = clamp(p.x, 130, 390); else p.x = (p.x + WIDTH) % WIDTH;
    if (p.y < 75) { p.y = 75; if (Math.sin(p.angle) < 0) p.angle = Math.abs(p.angle); }
    p.shot -= dt;
    const cooling = Math.min(1 / .6, (p.cooling ?? 1) * (p.model === 'skate' && p.angle > .35 ? 1.25 : 1));
    p.heat = Math.max(0, p.heat - dt * .5 * cooling);
    if (p.overheated && p.heat <= .1) p.overheated = false;
    if (c.fire && p.shot <= 0 && !p.overheated) {
      p.shot = .18; p.heat = Math.min(1, p.heat + .15); p.shield = 0;
      if (p.heat >= 1) p.overheated = true;
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
      s.bullets.push({ id: ++s.seq, owner: p.id, x: p.x + cos * 38, y: p.y + sin * 38, vx: cos * 650, vy: sin * 650, life: 1.5, damage: p.damage });
      fx(s, 'shot', p.x + cos * 40, p.y + sin * 40);
    }
    if (p.y > HEIGHT - 75) p.health = 0;
  }
  if (flight) {
    const scroll = def.scroll * dt; s.distance += scroll; s.totalDistance += scroll; s.spawn -= dt;
    for (const o of s.obstacles) {
      o.x -= scroll + (o.kind === 'fighter' || o.kind === 'heavy' ? 65 * dt : 0);
      o.fire -= dt;
      if (o.kind !== 'rock' && o.fire <= 0 && o.x < WIDTH) {
        o.fire = 2.6; const p = s.planes[0], a = Math.atan2(p.y - o.y, p.x - o.x);
        s.bullets.push({ id: ++s.seq, owner: 'obstacle-' + o.id, x: o.x, y: o.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, life: 4, damage: o.damage }); fx(s, 'shot', o.x, o.y);
      }
    }
    if (s.spawn <= 0) {
      s.spawn = def.spawn; const r = random(s);
      const kind: Obstacle['kind'] = r < .24 ? 'rock' : r < .48 && s.level >= 3 ? 'pvo' : r > .85 && s.level >= 6 ? 'heavy' : 'fighter';
      s.obstacles.push({ id: ++s.seq, kind, x: WIDTH + 80, y: kind === 'pvo' ? 580 : kind === 'rock' ? (random(s) > .5 ? 510 : 120) : 140 + random(s) * 340,
        radius: kind === 'rock' ? 72 : kind === 'heavy' ? 32 : 24, hp: kind === 'rock' ? 99999 : def.enemyHp * (kind === 'heavy' ? 2 : 1), fire: 1.4, damage: def.enemyDamage });
    }
    s.obstacles = s.obstacles.filter(o => o.x > -130 && o.hp > 0);
    for (const o of s.obstacles) {
      const p = s.planes[0];
      if (p.health > 0 && p.shield <= 0 && p.ram <= 0 && Math.hypot(p.x - o.x, p.y - o.y) < o.radius + 22) { p.health -= o.kind === 'rock' ? 45 : 25; p.ram = .8; fx(s, 'hit', p.x, p.y); }
    }
    if (s.distance >= def.length) { if (def.boss) beginBoss(s); else nextLevel(s, rewards); }
  }
  for (const b of s.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    for (const p of s.planes) {
      if (p.id === b.owner || p.health <= 0 || p.shield > 0 || b.life <= 0) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < 26) { p.health -= b.damage; p.lastAttacker = b.owner; b.life = 0; fx(s, 'hit', b.x, b.y); }
    }
    if (flight && b.owner === s.planes[0].id && b.life > 0) {
      for (const o of s.obstacles) {
        if (o.hp <= 0 || Math.hypot(o.x - b.x, o.y - b.y) > o.radius + 5) continue;
        b.life = 0; o.hp -= b.damage; fx(s, 'hit', b.x, b.y);
        if (o.hp <= 0) {
          const base = o.kind === 'pvo' ? [15, 8] : o.kind === 'heavy' ? [25, 12] : [10, 5];
          award(s, rewards, b.owner, base[0] * def.tier, base[1] * def.tier, 'kill'); fx(s, 'explosion', o.x, o.y); fx(s, 'reward', o.x, o.y, '+' + base[0] * def.tier + ' серебра');
        }
        break;
      }
    }
  }
  s.bullets = s.bullets.filter(b => b.life > 0 && b.x > -50 && b.x < WIDTH + 150 && b.y > 0 && b.y < HEIGHT);
  if (!flight && s.planes.length === 2) {
    const [a, b] = s.planes;
    if (a.health > 0 && b.health > 0 && a.shield <= 0 && b.shield <= 0 && a.ram <= 0 && b.ram <= 0 && Math.hypot(a.x - b.x, a.y - b.y) < 44) { a.health -= 25; b.health -= 25; a.lastAttacker = b.id; b.lastAttacker = a.id; a.ram = b.ram = 1; fx(s, 'hit', a.x, a.y); }
  }
  for (const p of s.planes) {
    if (p.health > 0 || p.dead > 0) continue;
    p.dead = 2; fx(s, 'explosion', p.x, p.y);
    if (s.mode === 'duel') {
      const other = s.planes.find(x => x.id !== p.id)!; other.score++;
      if (!other.bot && p.lastAttacker === other.id) rewards.push({ player: other.id, silver: 0, xp: 0, kind: 'kill' });
    }
  }
  if (s.mode === 'pve' && s.planes[0].health <= 0) { s.phase = 'ended'; s.result = 'Самолёт потерян'; }
  else if (s.phase === 'boss' && s.planes[1].health <= 0) {
    const b = s.level === 10 ? [150, 80] : s.level === 25 ? [350, 180] : [700, 350];
    award(s, rewards, s.planes[0].id, b[0], b[1], 'kill'); nextLevel(s, rewards);
  } else if (s.mode === 'duel' && (s.time >= 120 || s.planes.some(p => p.score >= 3))) endDuel(s, rewards);
  return rewards;
}
