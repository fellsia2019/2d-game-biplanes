import { GROUND_Y, rockPoints, pvoPoints, touchesPolygon, pvoAim, pvoModelsForLevel, type PvoModel } from './terrain';
import { WIDTH, HEIGHT, ZONE, bossBalance } from './data';
export interface Controls { turn: number; horizontal?: number; fire: boolean; boost: boolean }
export const IDLE: Controls = { turn: 0, fire: false, boost: false };
export interface Stats { model: string; hp: number; speed: number; turn: number; damage: number; boostDuration?: number; boostRecharge?: number; cooling?: number }
export interface Plane extends Stats { id: string; x: number; y: number; angle: number; health: number; heat: number; overheated: boolean; energy: number; shot: number; dead: number; shield: number; score: number; bot: boolean; ram: number; boosting?: boolean; lastAttacker?: string; patrolIndex?: number; windup?: number; aimAngle?: number }
export interface Bullet { id: number; owner: string; x: number; y: number; vx: number; vy: number; life: number; damage: number }
export interface Obstacle { id: number; kind: 'rock' | 'pvo' | 'fighter' | 'heavy'; x: number; y: number; radius: number; hp: number; fire: number; damage: number; height?: number; pvoModel?: PvoModel }
export interface Effect { id: number; kind: 'shot' | 'hit' | 'explosion' | 'reward' | 'level' | 'boss'; x: number; y: number; label?: string }
export interface Reward { player: string; silver: number; xp: number; kind: 'kill' | 'level' | 'duel'; win?: boolean; bossLevel?: number }
export interface Battle {
  id: string; mode: 'duel' | 'pve'; planes: Plane[]; bullets: Bullet[]; obstacles: Obstacle[]; effects: Effect[];
  time: number; distance: number; totalDistance: number; level: number; phase: 'flight' | 'boss' | 'duel' | 'ended';
  spawn: number; seq: number; seed: number; paused: boolean; result: string; earned: Record<string, { silver: number; xp: number }>; activity: Record<string, number>;
  bossAttempt?: number; bossAttemptsExhausted?: boolean;
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function random(s: Battle) { s.seed = (1664525 * s.seed + 1013904223) >>> 0; return s.seed / 4294967296; }
function fx(s: Battle, kind: Effect['kind'], x: number, y: number, label?: string) { s.effects.push({ id: ++s.seq, kind, x, y, label }); if (s.effects.length > 60) s.effects.shift(); }
// Aircraft weapons share one muzzle and heading calculation, regardless of owner.
function fireForward(s: Battle, owner: string, x: number, y: number, angle: number, speed: number, life: number, damage: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  s.bullets.push({ id: ++s.seq, owner, x: x + cos * 38, y: y + sin * 38, vx: cos * speed, vy: sin * speed, life, damage });
  fx(s, 'shot', x + cos * 40, y + sin * 40);
}
export function makePlane(id: string, stats: Stats, bot = false, side = 0): Plane {
  return { ...stats, id, bot, x: side ? 980 : 220, y: side ? 300 : 330, angle: side ? Math.PI : 0, health: stats.hp, heat: 0, overheated: false, energy: 1, shot: 0, dead: 0, shield: 1.5, score: 0, ram: 0 };
}
export function refreshPlaneStats(plane: Plane, stats: Stats) {
  const healthRatio = clamp(plane.health / plane.hp, 0, 1);
  Object.assign(plane, stats); plane.health = plane.hp * healthRatio;
}
export const CAMPAIGN_X = 220, FLIGHT_LEFT = CAMPAIGN_X, FLIGHT_RIGHT = WIDTH - 100, FLIGHT_TOP = 75, FLIGHT_BOTTOM = GROUND_Y - 22;
export function normalizeCampaignPlane(p: Plane) { p.x = clamp(p.x, FLIGHT_LEFT, FLIGHT_RIGHT); p.angle = 0; p.y = clamp(p.y, FLIGHT_TOP, FLIGHT_BOTTOM); }
export function createBattle(id: string, mode: Battle['mode'], planes: Plane[], level = 1): Battle {
  if (mode === 'pve') { planes[0].x = CAMPAIGN_X; normalizeCampaignPlane(planes[0]); planes[0].y = HEIGHT / 2; }
  return { id, mode, planes, bullets: [], obstacles: [], effects: [], time: 0, distance: 0, totalDistance: 0, level, phase: mode === 'pve' ? 'flight' : 'duel', spawn: 1.8, seq: 0, seed: [...id].reduce((a,c) => ((a * 31) + c.charCodeAt(0)) >>> 0, 12345), paused: false, result: '', earned: Object.fromEntries(planes.map(p => [p.id, { silver: 0, xp: 0 }])), activity: Object.fromEntries(planes.map(p => [p.id, 0])) };
}
function botControls(s: Battle, p: Plane): Controls {
  const target = s.planes.find(x => x.id !== p.id && x.health > 0);
  if (!target) return IDLE;
  if (s.phase === 'boss' && p.id === 'boss') {
    const route = s.level >= 50 ? [[960,150],[420,420],[960,460],[380,160],[710,300]]
      : s.level >= 25 ? [[960,150],[720,300],[420,460],[420,150],[720,300],[960,460]]
      : [[900,150],[600,150],[420,300],[600,460],[900,460],[1020,300]];
    let index = (p.patrolIndex ?? 0) % route.length;
    if (Math.hypot(p.x - route[index][0], p.y - route[index][1]) < 60) index = (index + 1) % route.length;
    p.patrolIndex = index;
    const heading = Math.atan2(route[index][1] - p.y, route[index][0] - p.x);
    const desired = p.y > 505 ? -Math.PI / 2 : p.y < 110 ? Math.PI / 2 : heading;
    const delta = angleDiff(desired, p.angle);
    return { turn: Math.abs(delta) < .08 ? 0 : Math.sign(delta), fire: true, boost: false };
  }
  const dx = target.x - p.x, dy = target.y - p.y;
  const aim = Math.atan2(dy, dx) + Math.sin(s.time * 2 + p.x * .002) * .12;
  const desired = p.y > 490 ? -.8 : p.y < 130 ? .8 : aim;
  const d = angleDiff(desired, p.angle);
  return { turn: Math.abs(d) < .12 ? 0 : Math.sign(d), fire: Math.abs(d) < .28 && Math.hypot(dx, dy) < 900, boost: Math.hypot(dx, dy) > 450 && Math.abs(d) < .3 };
}
function award(s: Battle, rewards: Reward[], player: string, silver: number, xp: number, kind: Reward['kind'], win?: boolean, bossLevel?: number) {
  if (!s.earned[player]) return;
  s.earned[player].silver += silver; s.earned[player].xp += xp;
  rewards.push({ player, silver, xp, kind, win, ...(bossLevel ? {bossLevel} : {}) });
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
  award(s, rewards, human.id, def.rewardSilver, def.rewardXp, 'level', true);
  if (s.level === 50) { s.phase = 'ended'; s.result = 'Рубеж пройден!'; return; }
  const fromBoss = s.phase === 'boss';
  s.level++; s.distance = 0; s.spawn = 2; s.phase = 'flight';
  if (fromBoss) s.bullets = [];
  if (fromBoss) s.bossAttempt = undefined;
  s.planes = [human];
  normalizeCampaignPlane(human);
  if (fromBoss) { human.x = CAMPAIGN_X; human.y = HEIGHT / 2; human.shield = 2; }
  fx(s, 'level', WIDTH / 2, 150, 'УРОВЕНЬ ' + s.level);
}
export function beginBoss(s: Battle) {
  const def = ZONE[s.level - 1]; if (!def.boss) return;
  s.phase = 'boss'; s.obstacles = []; s.bullets = [];
  const human = s.planes[0]; human.x = 230; human.y = 330; human.angle = 0; human.health = human.hp; human.heat = 0; human.overheated = false; human.energy = 1; human.shield = 2;
  s.planes = [human, makePlane('boss', { model: 'enemy', hp: def.boss.hp, speed: def.boss.speed, turn: def.boss.turn, damage: def.boss.damage }, true, 1)];
  s.planes[1].shot = 1.2;
  fx(s, 'boss', WIDTH / 2, 190, def.boss.name);
}
export function stepBattle(s: Battle, inputs: Record<string, Controls>, dt: number): Reward[] {
  const rewards: Reward[] = [];
  if (s.paused || s.phase === 'ended') return rewards;
  s.time += dt;
  const flight = s.mode === 'pve' && s.phase === 'flight', def = ZONE[s.level - 1];
  for (const p of s.planes) {
    p.ram = Math.max(0, p.ram - dt); p.shield = Math.max(0, p.shield - dt);
    if (p.health <= 0) {
      if (s.mode !== 'duel' || p.dead === 0) continue;
      p.dead -= dt;
      if (p.dead <= 0) { p.dead = 0; p.health = p.hp; p.x = p.bot || s.planes.indexOf(p) ? 980 : 220; p.y = 200 + random(s) * 200; p.angle = p.x > 600 ? Math.PI : 0; p.heat = 0; p.overheated = false; p.energy = 1; p.shield = 1.5; p.lastAttacker = undefined; }
      continue;
    }
    const boss = p.bot && p.id === 'boss' && s.phase === 'boss';
    const bossDef = bossBalance(s.level);
    if (boss) {
      p.speed = bossDef.speed; p.turn = bossDef.turn; p.damage = bossDef.damage;
    }
    const c = p.bot ? botControls(s, p) : inputs[p.id] ?? IDLE;
    s.activity ??= {};
    if (!p.bot && (c.turn || c.horizontal || c.fire || c.boost)) s.activity[p.id] = (s.activity[p.id] ?? 0) + dt;
    const boosting = c.boost && p.energy > .03; p.boosting = boosting;
    p.energy = clamp(p.energy + dt * (boosting ? -1 / (p.boostDuration ?? 2) : 1 / (p.boostRecharge ?? 6)), 0, 1);
    const speed = p.speed * (boosting ? 1.3 : 1);
    if (flight) {
      normalizeCampaignPlane(p);
      p.x = clamp(p.x + clamp(c.horizontal ?? 0, -1, 1) * speed * dt, FLIGHT_LEFT, FLIGHT_RIGHT);
      p.y = clamp(p.y + clamp(c.turn, -1, 1) * speed * dt, FLIGHT_TOP, FLIGHT_BOTTOM);
    } else {
      p.angle = angleDiff(p.angle + clamp(c.turn, -1, 1) * p.turn * dt, 0);
      p.x = (p.x + Math.cos(p.angle) * speed * dt + WIDTH) % WIDTH;
      p.y += Math.sin(p.angle) * speed * dt;
      if (p.y < 75) { p.y = 75; if (Math.sin(p.angle) < 0) p.angle = Math.abs(p.angle); }
    }
    p.shot -= dt;
    const cooling = Math.min(1 / .6, (p.cooling ?? 1) * (p.model === 'skate' && (flight ? c.turn > 0 : p.angle > .35) ? 1.25 : 1));
    p.heat = Math.max(0, p.heat - dt * .5 * cooling);
    if (p.overheated && p.heat <= .1) p.overheated = false;
    if (boss) {
      if (p.windup !== undefined) {
        p.windup -= dt;
        if (p.windup <= 0) {
          fireForward(s,p.id,p.x,p.y,p.aimAngle ?? p.angle,bossDef.bulletSpeed,4,p.damage);
          p.windup = undefined; p.shot = bossDef.cooldown - bossDef.windup; p.shield = 0;
        }
      } else if (c.fire && p.shot <= 0) {
        const target = s.planes.find(q => q.id !== p.id && q.health > 0);
        if (target) { p.aimAngle = Math.atan2(target.y-p.y,target.x-p.x); p.windup = bossDef.windup; }
      }
    } else if (c.fire && p.shot <= 0 && !p.overheated) {
      p.shot = .18; p.heat = Math.min(1, p.heat + .15); p.shield = 0;
      if (p.heat >= 1) p.overheated = true;
      fireForward(s, p.id, p.x, p.y, p.angle, 650, 1.5, p.damage);
    }
    if (p.y + (boss ? 34 : 22) >= GROUND_Y) p.health = 0;
  }
  if (flight) {
    const scroll = def.scroll * (s.planes[0].boosting ? 1.7 : 1) * dt; s.distance += scroll; s.totalDistance += scroll; s.spawn -= dt;
    for (const o of s.obstacles) {
      if (o.kind === 'rock' || o.kind === 'pvo') o.y = GROUND_Y;
      o.x -= scroll + (o.kind === 'fighter' || o.kind === 'heavy' ? 65 * dt : 0);
      o.fire -= dt;
    }
    if (s.spawn <= 0) {
      s.spawn = def.spawn; const r = random(s);
      const pvoModels = pvoModelsForLevel(s.level);
      const kind: Obstacle['kind'] = r < .24 ? 'rock' : r < .48 && pvoModels.length ? 'pvo' : r > .85 && s.level >= 6 ? 'heavy' : 'fighter';
      s.obstacles.push({ id: ++s.seq, kind, x: WIDTH + 80, y: kind === 'pvo' || kind === 'rock' ? GROUND_Y : 140 + random(s) * 340,
        height: kind === 'rock' ? 140 + random(s) * 140 : undefined, pvoModel: kind === 'pvo' ? pvoModels[Math.floor(random(s) * pvoModels.length)] : undefined,
        radius: kind === 'rock' ? 72 : kind === 'heavy' ? 32 : 24, hp: kind === 'rock' ? 99999 : def.enemyHp * (kind === 'heavy' ? 2 : 1), fire: 1.4, damage: def.enemyDamage });
    }
    const solid = s.obstacles.filter(o => o.hp > 0 && (o.kind === 'rock' || o.kind === 'pvo')).map(o => ({
      obstacle: o, points: o.kind === 'rock' ? rockPoints(o) : pvoPoints(o),
    }));
    for (const o of s.obstacles) {
      if (o.hp <= 0) continue;
      if (o.kind === 'fighter' || o.kind === 'heavy') {
        const crashed = () => o.y + o.radius >= GROUND_Y || solid.some(g => touchesPolygon(o.x, o.y, o.radius, g.points));
        if (!crashed()) {
          let altitude = o.y;
          // Enemies face left. Look three seconds ahead in ground-relative space;
          // climb early enough for the widest, tallest rock, without teleporting.
          for (const g of solid) {
            const left = Math.min(...g.points.map(p => p.x)), right = Math.max(...g.points.map(p => p.x));
            if (left > o.x + o.radius || right < o.x - o.radius - 65 * 3) continue;
            altitude = Math.min(altitude, Math.min(...g.points.map(p => p.y)) - o.radius - 18);
          }
          o.y = Math.max(FLIGHT_TOP + o.radius, o.y - Math.min(150 * dt, Math.max(0, o.y - altitude)));
        }
        if (crashed()) { o.hp = 0; fx(s, 'explosion', o.x, o.y); continue; }
      }
      if (o.kind !== 'rock' && o.fire <= 0 && o.x < WIDTH) {
        o.fire = o.kind === 'pvo' ? def.pvoCooldown : def.mobCooldown;
        if (o.kind === 'pvo') {
          const muzzle = pvoAim(o.x, s.planes[0]);
          s.bullets.push({ id: ++s.seq, owner: 'obstacle-' + o.id, x: muzzle.x, y: muzzle.y, vx: Math.cos(muzzle.angle) * 240, vy: Math.sin(muzzle.angle) * 240, life: 4, damage: o.damage }); fx(s, 'shot', muzzle.x, muzzle.y);
        } else {
          // Campaign aircraft face left, matching their mirrored sprites.
          fireForward(s, 'obstacle-' + o.id, o.x, o.y, Math.PI, 240, 4, o.damage);
        }
      }
    }
    s.obstacles = s.obstacles.filter(o => o.x > -130 && o.hp > 0);
    for (const o of s.obstacles) {
      const p = s.planes[0];
      const ground = o.kind === 'rock' || o.kind === 'pvo';
      const touching = ground ? touchesPolygon(p.x, p.y, 22, o.kind === 'rock' ? rockPoints(o) : pvoPoints(o)) : Math.hypot(p.x - o.x, p.y - o.y) < o.radius + 22;
      // Shields and the ram cooldown never allow flying through solid terrain.
      if (p.health > 0 && touching && (ground || p.ram <= 0)) { p.health = ground ? 0 : p.health - p.hp * .5; p.ram = .8; fx(s, 'hit', p.x, p.y); }
    }
    if (s.planes[0].health > 0 && s.distance >= def.length) { if (def.boss) beginBoss(s); else nextLevel(s, rewards); }
  }
  for (const b of s.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    for (const p of s.planes) {
      if (p.id === b.owner || p.health <= 0 || p.shield > 0 || b.life <= 0) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < (p.id === 'boss' ? 38 : 26)) { p.health -= b.damage; p.lastAttacker = b.owner; b.life = 0; fx(s, 'hit', b.x, b.y); }
    }
    if (flight && b.owner === s.planes[0].id && b.life > 0) {
      for (const o of s.obstacles) {
        const touching = o.kind === 'rock' || o.kind === 'pvo' ? touchesPolygon(b.x, b.y, 5, o.kind === 'rock' ? rockPoints(o) : pvoPoints(o)) : Math.hypot(o.x - b.x, o.y - b.y) <= o.radius + 5;
        if (o.hp <= 0 || !touching) continue;
        b.life = 0; o.hp -= b.damage; fx(s, 'hit', b.x, b.y);
        if (o.hp <= 0) {
          const multiplier = o.kind === 'pvo' ? 1.25 : o.kind === 'heavy' ? 1.6 : 1;
          const silver = Math.round(def.killSilver * multiplier), xp = Math.round(def.killXp * multiplier);
          award(s, rewards, b.owner, silver, xp, 'kill'); fx(s, 'explosion', o.x, o.y); fx(s, 'reward', o.x, o.y, '+' + silver + ' серебра');
        }
        break;
      }
    }
  }
  s.bullets = s.bullets.filter(b => b.life > 0 && b.x > -50 && b.x < WIDTH + 150 && b.y > 0 && b.y < HEIGHT);
  if (!flight && s.planes.length === 2) {
    const [a, b] = s.planes;
    const touching = a.health > 0 && b.health > 0 && Math.hypot(a.x - b.x, a.y - b.y) < (s.phase === 'boss' ? 56 : 44);
    if (touching && s.phase === 'boss') {
      a.health = 0; a.lastAttacker = b.id; fx(s, 'hit', a.x, a.y);
    } else if (touching && a.ram <= 0 && b.ram <= 0) {
      a.health -= a.hp * .5; b.health -= b.hp * .5; a.lastAttacker = b.id; b.lastAttacker = a.id; a.ram = b.ram = 1; fx(s, 'hit', a.x, a.y);
    }
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
    const b = bossBalance(s.level);
    award(s, rewards, s.planes[0].id, b.silver, b.xp, 'kill', true, s.level); nextLevel(s, rewards);
  } else if (s.mode === 'duel' && (s.time >= 120 || s.planes.some(p => p.score >= 3))) endDuel(s, rewards);
  return rewards;
}
