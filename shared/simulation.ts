import { GROUND_Y, rockPoints, pvoPoints, touchesPolygon, pvoAim, pvoModelsForLevel, type PvoModel } from './terrain';
import { WIDTH, HEIGHT, ZONE, bossBalance, campaignReward } from './data';
import type { ModifierBonuses } from './modifiers';
import { combatReward } from './premium';
import { PHASE_SKILL } from './skills';
import { freshOperation, operationPlan, operationMission, missionComplete, sortieReward, type OperationState } from './operations';
import { BOMBER, bomberFormation, bomberAimDropX, bombsDropped, touchesBomber, type Bomber } from './bombers';
export type { Bomber } from './bombers';
export interface Controls { turn: number; horizontal?: number; fire: boolean; boost: boolean; skill?: boolean }
export const IDLE: Controls = { turn: 0, fire: false, boost: false };
export interface Stats { model: string; hp: number; speed: number; turn: number; damage: number; boostDuration?: number; boostRecharge?: number; cooling?: number; traits?: ModifierBonuses; rewardMultiplier?: number; phaseSkill?: boolean }
interface DuelDecision { next: number; turn: number; fire: boolean; boost: boolean; aimError: number; burstUntil: number; nextBurst: number; separating?: boolean; separationSide?: number; nextEvasion?: number; evasionStart?: number; evasionUntil?: number; evasionHeading?: number; evasionSide?: number }
export interface Plane extends Stats { id: string; x: number; y: number; angle: number; health: number; heat: number; overheated: boolean; energy: number; shot: number; dead: number; shield: number; score: number; bot: boolean; ram: number; boosting?: boolean; boostExhausted?: boolean; lastAttacker?: string; patrolIndex?: number; windup?: number; aimAngle?: number; rocketClock?: number; emergencyUsed?: boolean; phaseSeconds?: number; phaseCooldown?: number; skillHeld?: boolean; duelDecision?: DuelDecision }
export interface Bullet { id: number; owner: string; x: number; y: number; vx: number; vy: number; life: number; damage: number; kind?: 'rocket' | 'bomb'; piercing?: number; hitTargets?: string[] }
export interface Obstacle { id: number; kind: 'rock' | 'pvo' | 'fighter' | 'heavy'; x: number; y: number; radius: number; hp: number; fire: number; damage: number; height?: number; pvoModel?: PvoModel; terrainVariant?: number; elite?: boolean }
export interface Pickup { id: number; x: number; y: number; kind: 'recon' | 'supply'; retired?: boolean }
export interface Effect { id: number; kind: 'shot' | 'hit' | 'explosion' | 'reward' | 'level' | 'boss'; x: number; y: number; label?: string }
export interface Reward { player: string; silver: number; xp: number; kind: 'kill' | 'level' | 'duel' | 'sortie'; win?: boolean; bossLevel?: number }
export interface Battle {
  id: string; mode: 'duel' | 'pve'; planes: Plane[]; bullets: Bullet[]; obstacles: Obstacle[]; effects: Effect[];
  time: number; distance: number; totalDistance: number; level: number; phase: 'flight' | 'sortie-reward' | 'boss-intro' | 'boss' | 'reward' | 'duel' | 'ended';
  spawn: number; seq: number; seed: number; paused: boolean; result: string; earned: Record<string, { silver: number; xp: number }>; activity: Record<string, number>;
  bossAttempt?: number; bossAttemptsExhausted?: boolean; restartLevel?: number;
  bossAttemptsUnlimited?: boolean;
  rewardBossLevel?: number; rewardNextPhase?: 'flight' | 'ended';
  encounterSeed?: number;
  missionIntro?: string;
  operation?: OperationState; pickups?: Pickup[];
  bombers?: Bomber[]; bomberClock?: number;
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// Boss art occupies about 175×78 world units. Rotate the generous projectile
// target with the model and test the entire bullet path, including grazing hits.
function hitsBoss(p: Plane, fromX: number, fromY: number, toX: number, toY: number) {
  const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
  const local = (x: number, y: number) => ({x: ((x-p.x)*cos+(y-p.y)*sin)/90, y: (-(x-p.x)*sin+(y-p.y)*cos)/45});
  const a = local(fromX,fromY), b = local(toX,toY), dx = b.x-a.x, dy = b.y-a.y;
  const length = dx*dx+dy*dy;
  const t = length ? clamp(-(a.x*dx+a.y*dy)/length,0,1) : 0;
  return (a.x+t*dx)**2+(a.y+t*dy)**2 <= 1;
}
function random(s: Battle) { s.seed = (1664525 * s.seed + 1013904223) >>> 0; return s.seed / 4294967296; }
function encounterRandom(s: Battle) {
  if (s.operation) {
    s.encounterSeed = (1664525 * (s.encounterSeed ?? operationMission(s.level, s.operation.completed).seed) + 1013904223) >>> 0;
    return s.encounterSeed / 4294967296;
  }
  if (!ZONE[s.level - 1].encounter) return random(s);
  s.encounterSeed = (1664525 * (s.encounterSeed ?? ZONE[s.level - 1].encounter!.seed) + 1013904223) >>> 0;
  return s.encounterSeed / 4294967296;
}
function fx(s: Battle, kind: Effect['kind'], x: number, y: number, label?: string) { s.effects.push({ id: ++s.seq, kind, x, y, label }); if (s.effects.length > 60) s.effects.shift(); }
// Aircraft weapons share one muzzle and heading calculation, regardless of owner.
function fireForward(s: Battle, owner: string, x: number, y: number, angle: number, speed: number, life: number, damage: number, piercing = 0, kind?: 'rocket') {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  s.bullets.push({ id: ++s.seq, owner, x: x + cos * 38, y: y + sin * 38, vx: cos * speed, vy: sin * speed, life, damage, ...(piercing ? {piercing, hitTargets: []} : {}), ...(kind ? {kind} : {}) });
  fx(s, 'shot', x + cos * 40, y + sin * 40);
}
export function makePlane(id: string, stats: Stats, bot = false, side = 0): Plane {
  return { ...stats, id, bot, x: side ? 980 : 220, y: side ? 300 : 330, angle: side ? Math.PI : 0, health: stats.hp, heat: 0, overheated: false, energy: 1, shot: 0, dead: 0, shield: 1.5, score: 0, ram: 0 };
}
export function refreshPlaneStats(plane: Plane, stats: Stats) {
  const healthRatio = clamp(plane.health / plane.hp, 0, 1);
  Object.assign(plane, stats); plane.health = plane.hp * healthRatio;
}
// A 400px aircraft texture at .32 scale fits entirely inside this equal edge margin.
export const FLIGHT_EDGE_MARGIN = 64;
export const CAMPAIGN_X = 220, FLIGHT_LEFT = FLIGHT_EDGE_MARGIN, FLIGHT_RIGHT = WIDTH - FLIGHT_EDGE_MARGIN, FLIGHT_TOP = 75, FLIGHT_BOTTOM = GROUND_Y - 22;
export function normalizeCampaignPlane(p: Plane) { p.x = clamp(p.x, FLIGHT_LEFT, FLIGHT_RIGHT); p.angle = 0; p.y = clamp(p.y, FLIGHT_TOP, FLIGHT_BOTTOM); }
export function createBattle(id: string, mode: Battle['mode'], planes: Plane[], level = 1): Battle {
  if (mode === 'pve') { planes[0].x = CAMPAIGN_X; normalizeCampaignPlane(planes[0]); planes[0].y = HEIGHT / 2; }
  return { id, mode, planes, bullets: [], obstacles: [], effects: [], time: 0, distance: 0, totalDistance: 0, level, phase: mode === 'pve' ? 'flight' : 'duel', spawn: 1.8, seq: 0, seed: [...id].reduce((a,c) => ((a * 31) + c.charCodeAt(0)) >>> 0, 12345), paused: false, result: '', earned: Object.fromEntries(planes.map(p => [p.id, { silver: 0, xp: 0 }])), activity: Object.fromEntries(planes.map(p => [p.id, 0])), ...(mode === 'pve' ? {operation:freshOperation(), pickups:[]} : {}) };
}
function botControls(s: Battle, p: Plane): Controls {
  const target = s.planes.find(x => x.id !== p.id && x.health > 0);
  if (!target) return IDLE;
  if (s.phase === 'boss' && p.id === 'boss') {
    const pattern = bossBalance(s.level).pattern ?? (s.level >= 50 ? 'cross' : s.level >= 25 ? 'weave' : 'orbit');
    const routes = {
      cross: [[960,150],[420,420],[960,460],[380,160],[710,300]],
      weave: [[960,150],[720,300],[420,460],[420,150],[720,300],[960,460]],
      orbit: [[900,150],[600,150],[420,300],[600,460],[900,460],[1020,300]],
      sweep: [[1040,160],[560,160],[560,440],[1040,440],[820,300]],
    };
    const route = routes[pattern];
    let index = (p.patrolIndex ?? 0) % route.length;
    if (Math.hypot(p.x - route[index][0], p.y - route[index][1]) < 60) index = (index + 1) % route.length;
    p.patrolIndex = index;
    const heading = Math.atan2(route[index][1] - p.y, route[index][0] - p.x);
    const desired = p.y > 505 ? -Math.PI / 2 : p.y < 110 ? Math.PI / 2 : heading;
    const delta = angleDiff(desired, p.angle);
    return { turn: Math.abs(delta) < .08 ? 0 : Math.sign(delta), fire: true, boost: false };
  }
  if (s.mode === 'duel') return duelBotControls(s, p, target);
  const dx = target.x - p.x, dy = target.y - p.y;
  const aim = Math.atan2(dy, dx) + Math.sin(s.time * 2 + p.x * .002) * .12;
  const desired = p.y > 490 ? -.8 : p.y < 130 ? .8 : aim;
  const d = angleDiff(desired, p.angle);
  return { turn: Math.abs(d) < .12 ? 0 : Math.sign(d), fire: Math.abs(d) < .28 && Math.hypot(dx, dy) < 900, boost: Math.hypot(dx, dy) > 450 && Math.abs(d) < .3 };
}
function duelBotControls(s: Battle, p: Plane, target: Plane): Controls {
  const decision = p.duelDecision ??= {next:0, turn:0, fire:false, boost:false, aimError:0, burstUntil:0, nextBurst:0};
  // The duel wraps horizontally, so separation uses the nearest copy of the opponent.
  const rawDx = target.x - p.x, dx = rawDx > WIDTH / 2 ? rawDx - WIDTH : rawDx < -WIDTH / 2 ? rawDx + WIDTH : rawDx;
  const dy = target.y - p.y, distance = Math.hypot(dx, dy);
  decision.nextEvasion ??= s.time + 6 + random(s) * 2;
  if (s.time >= decision.nextEvasion) {
    decision.evasionStart = s.time;
    decision.evasionUntil = s.time + 2 + random(s);
    decision.nextEvasion = s.time + 6 + random(s) * 2;
    decision.evasionHeading = Math.atan2(dy, dx) + Math.PI;
    decision.evasionSide = random(s) < .5 ? -1 : 1;
    decision.next = 0;
  }
  const separating = distance < 220 || !!decision.separating && distance < 300;
  if (separating !== !!decision.separating) {
    decision.next = 0;
    if (separating) {
      const tangentY = Math.sin(Math.atan2(dy, dx) + Math.PI / 2);
      decision.separationSide = tangentY * (330 - p.y) >= 0 ? 1 : -1;
    }
  }
  decision.separating = separating;
  const evading = s.time < (decision.evasionUntil ?? 0);
  if (s.time >= decision.next) {
    const reaction = .25 + random(s) * .05;
    decision.next = s.time + reaction;
    decision.aimError = (random(s) * 2 - 1) * Math.PI / 18;
    // During the scheduled break, follow a fixed zigzag rather than the player's tail.
    const zigzag = (Math.floor((s.time - (decision.evasionStart ?? 0)) / .6) % 2 ? -1 : 1) * (decision.evasionSide ?? 1) * .65;
    const aim = Math.atan2(dy, dx) + decision.aimError;
    const heading = evading ? decision.evasionHeading! + zigzag : separating ? Math.atan2(dy, dx) + (decision.separationSide ?? 1) * 2.15 : aim;
    const delta = angleDiff(heading, p.angle);
    // Hold a decision between observations without overshooting a small turn.
    decision.turn = Math.abs(delta) < .05 ? 0 : clamp(delta / (p.turn * reaction), -1, 1);
    decision.fire = !evading && Math.abs(angleDiff(aim, p.angle)) < .3 && distance < 900;
    decision.boost = !evading && !separating && distance > 550 && Math.abs(delta) < .25;
  }
  if (s.time >= decision.nextBurst) {
    decision.burstUntil = s.time + .55 + random(s) * .3;
    decision.nextBurst = decision.burstUntil + .4 + random(s) * .25;
  }
  // Safety stays immediate: a slower target reaction must not cause ground crashes.
  if (p.y > 490 || p.y < 125) {
    const heading = p.y > 490 ? -Math.PI / 2 : Math.PI / 2;
    const delta = angleDiff(heading, p.angle);
    return {turn:Math.abs(delta) < .08 ? 0 : Math.sign(delta), fire:false, boost:false};
  }
  return {turn:decision.turn, fire:!evading && decision.fire && s.time < decision.burstUntil, boost:!evading && !separating && decision.boost};
}
function award(s: Battle, rewards: Reward[], player: string, silver: number, xp: number, kind: Reward['kind'], win?: boolean, bossLevel?: number) {
  if (!s.earned[player]) return;
  if (s.mode === 'pve') { silver = campaignReward(silver); xp = campaignReward(xp); }
  const multiplier = s.planes.find(p => p.id === player)?.rewardMultiplier ?? 1;
  silver = combatReward(silver, multiplier); xp = combatReward(xp, multiplier);
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
  if (s.level === ZONE.length) { s.phase = 'ended'; s.result = 'Рубеж пройден!'; return; }
  const fromBoss = s.phase === 'boss';
  s.level++; s.distance = 0; s.spawn = 2; s.phase = 'flight';
  s.operation = freshOperation(); human.health = human.hp; human.heat = 0; human.overheated = false;
  if (fromBoss) { s.obstacles = []; s.pickups = []; s.bombers = []; s.bomberClock = 18; }
  else for (const pickup of s.pickups ?? []) pickup.retired = true;
  s.encounterSeed = ZONE[s.level - 1].encounter?.seed;
  if (fromBoss) s.bullets = [];
  if (fromBoss) s.bossAttempt = undefined;
  s.planes = [human];
  normalizeCampaignPlane(human);
  if (fromBoss) { human.x = CAMPAIGN_X; human.y = HEIGHT / 2; human.shield = 2; }
  fx(s, 'level', WIDTH / 2, 150, 'УРОВЕНЬ ' + s.level);
}
export function beginBoss(s: Battle) {
  const def = ZONE[s.level - 1]; if (!def.boss) return;
  s.phase = 'boss'; s.obstacles = []; s.bullets = []; s.pickups = []; s.bombers = []; s.bomberClock = 18;
  const human = s.planes[0]; human.x = 230; human.y = 330; human.angle = 0; human.health = human.hp; human.heat = 0; human.overheated = false; human.energy = 1; human.boostExhausted = false; human.shield = 2; human.rocketClock = 10;
  s.planes = [human, makePlane('boss', { model: 'enemy', hp: def.boss.hp, speed: def.boss.speed, turn: def.boss.turn, damage: def.boss.damage }, true, 1)];
  s.planes[1].shot = 1.2;
  fx(s, 'boss', WIDTH / 2, 190, def.boss.name);
}
function awardSortie(s:Battle, rewards:Reward[]) {
  const pilot=s.planes[0], budget=sortieReward(s.level), multiplier=pilot.rewardMultiplier ?? 1;
  // Kill bounties were credited immediately. Completion only tops up to the
  // guaranteed total; strong play above that total keeps its additional income.
  const silver=Math.max(0,combatReward(campaignReward(budget.silver),multiplier)-(s.operation!.killSilver ?? 0));
  const xp=Math.max(0,combatReward(campaignReward(budget.xp),multiplier)-(s.operation!.killXp ?? 0));
  s.earned[pilot.id].silver+=silver;s.earned[pilot.id].xp+=xp;
  rewards.push({player:pilot.id,silver,xp,kind:'sortie',win:true});
}
export function approachBoss(s: Battle) { beginBoss(s); if (s.phase === 'boss') { s.phase = 'boss-intro'; s.paused = true; } }
export function startBossFight(s: Battle) {
  if (s.phase !== 'boss-intro') throw new Error('Бой с боссом уже начат');
  s.phase = 'boss'; s.paused = false;
}
export function finishSortie(s: Battle) {
  if (s.phase !== 'sortie-reward') throw new Error('Вылет ещё не завершён');
  const completed = s.operation!.completed;
  s.operation = freshOperation(completed); s.phase = 'flight'; s.paused = false; s.distance = 0; s.spawn = 1.8;
  // Keep the world in motion across sorties; only their objective counters reset.
  for (const pickup of s.pickups ?? []) pickup.retired = true;
  s.encounterSeed = operationMission(s.level, completed).seed;
  const pilot = s.planes[0]; pilot.health = pilot.hp; pilot.heat = 0; pilot.overheated = false; pilot.energy = 1; pilot.boostExhausted = false; pilot.shield = 2;
  normalizeCampaignPlane(pilot);
}
export function restoreOperationProgress(s: Battle, completed: number) {
  if (s.mode !== 'pve' || s.phase !== 'flight' || !Number.isInteger(completed) || completed < 0 || completed >= operationPlan(s.level).sorties) throw new Error('Некорректное сохранение операции');
  s.operation = freshOperation(completed); s.pickups = []; s.encounterSeed = operationMission(s.level, completed).seed;
}
export function finishBossReward(s: Battle) {
  if (s.phase !== 'reward') return;
  // A pending final reward from an older, shorter route continues into new content.
  if (s.rewardNextPhase === 'ended' && (s.rewardBossLevel ?? s.level) < ZONE.length) {
    s.level = (s.rewardBossLevel ?? s.level) + 1; s.distance = 0; s.spawn = 2;
    s.rewardNextPhase = 'flight'; s.result = ''; s.obstacles = []; s.bullets = [];
    s.planes = [s.planes[0]]; normalizeCampaignPlane(s.planes[0]);
    s.planes[0].x = CAMPAIGN_X; s.planes[0].y = HEIGHT / 2; s.planes[0].shield = 2;
    s.bossAttempt = undefined; s.encounterSeed = ZONE[s.level - 1].encounter?.seed;
  }
  s.phase = s.rewardNextPhase ?? 'flight'; s.rewardNextPhase = undefined; s.rewardBossLevel = undefined; s.paused = false;
}
function autoRocket(s: Battle, p: Plane, dt: number) {
  if (!p.traits?.rocketDamage || s.mode !== 'pve') return;
  p.rocketClock = Math.max(0, (p.rocketClock ?? 10) - dt);
  if (p.rocketClock > 0) return;
  const ground = s.obstacles.filter(o => o.kind === 'pvo' && o.hp > 0 && o.x >= 0 && o.x <= WIDTH);
  const aircraft = s.obstacles.filter(o => (o.kind === 'fighter' || o.kind === 'heavy') && o.hp > 0 && o.x >= 0 && o.x <= WIDTH);
  const planes = s.planes.filter(q => q.id !== p.id && q.health > 0);
  const scroll = s.phase === 'flight' ? ZONE[s.level - 1].scroll * (p.boosting ? 1.7 : 1) : 0;
  const targets = (ground.length ? ground : [...aircraft, ...planes]).map(t => ({
    x: t.x, y: t.y - ('kind' in t && t.kind === 'pvo' ? 30 : 0),
    vx: 'kind' in t ? -scroll - (t.kind === 'pvo' ? 0 : 65) : Math.cos(t.angle) * t.speed,
    vy: 'kind' in t ? 0 : Math.sin(t.angle) * t.speed,
  }));
  const target = targets.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (!target) return;
  // Lead the scrolling target at launch. The rocket's heading then stays fixed.
  const dx = target.x - p.x, dy = target.y - p.y, a = target.vx ** 2 + target.vy ** 2 - 520 ** 2;
  const b = 2 * (dx * target.vx + dy * target.vy), c = dx ** 2 + dy ** 2;
  const lead = Math.abs(a) > .001 ? Math.max(0, (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a)) : 0;
  fireForward(s, p.id, p.x, p.y, Math.atan2(dy + target.vy * lead, dx + target.vx * lead), 520, 3, p.damage * p.traits.rocketDamage, 0, 'rocket');
  p.rocketClock = 10; p.shield = 0;
}
function bulletHit(b: Bullet, target: string, solid = false) {
  (b.hitTargets ??= []).push(target);
  if (!solid && (b.piercing ?? 0) > 0) b.piercing!--;
  else b.life = 0;
}
export function stepBattle(s: Battle, inputs: Record<string, Controls>, dt: number): Reward[] {
  const rewards: Reward[] = [];
  if (s.paused || s.phase === 'ended' || s.phase === 'boss-intro' || s.phase === 'reward' || s.phase === 'sortie-reward') return rewards;
  s.time += dt;
  const flight = s.mode === 'pve' && s.phase === 'flight', def = ZONE[s.level - 1];
  if (flight) s.operation ??= freshOperation();
  const mission = flight ? operationMission(s.level, s.operation!.completed) : undefined;
  for (const p of s.planes) {
    p.ram = Math.max(0, p.ram - dt); p.shield = Math.max(0, p.shield - dt);
    if (p.health <= 0) {
      if (s.mode !== 'duel' || p.dead === 0) continue;
      p.dead -= dt;
      if (p.dead <= 0) { p.dead = 0; p.health = p.hp; p.x = p.bot || s.planes.indexOf(p) ? 980 : 220; p.y = 200 + random(s) * 200; p.angle = p.x > 600 ? Math.PI : 0; p.heat = 0; p.overheated = false; p.energy = 1; p.boostExhausted = false; p.shield = 1.5; p.lastAttacker = undefined; }
      continue;
    }
    const boss = p.bot && p.id === 'boss' && s.phase === 'boss';
    const bossDef = bossBalance(s.level);
    if (boss) {
      p.speed = bossDef.speed; p.turn = bossDef.turn; p.damage = bossDef.damage;
    }
    const c = p.bot ? botControls(s, p) : inputs[p.id] ?? IDLE;
    p.phaseSeconds = Math.max(0, (p.phaseSeconds ?? 0) - dt); p.phaseCooldown = Math.max(0, (p.phaseCooldown ?? 0) - dt);
    if (!p.bot && p.phaseSkill && s.mode === 'pve' && c.skill && !p.skillHeld && !p.phaseCooldown) { p.phaseSeconds = PHASE_SKILL.duration; p.phaseCooldown = PHASE_SKILL.cooldown; fx(s,'reward',p.x,p.y,'ФАЗОВЫЙ ПРОХОД'); }
    p.skillHeld = c.skill === true;
    s.activity ??= {};
    if (!p.bot && (c.turn || c.horizontal || c.fire || c.boost)) s.activity[p.id] = (s.activity[p.id] ?? 0) + dt;
    if (p.energy >= 1) p.boostExhausted = false;
    else if (p.energy <= .03) p.boostExhausted = true;
    const boosting = c.boost && !p.boostExhausted && p.energy > .03; p.boosting = boosting;
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
    const descending = flight ? c.turn > 0 : Math.sin(p.angle) > Math.sin(.35);
    const cooling = Math.min(1 / .6, (p.cooling ?? 1) * (p.model === 'skate' && descending ? 1.25 : 1)) * (1 + (p.traits?.cooling ?? 0));
    if (s.mode === 'pve' && !p.bot) p.health = Math.min(p.hp, p.health + p.hp * (p.traits?.regeneration ?? 0) * dt);
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
      const damage = p.damage * (p.traits?.criticalChance && random(s) < p.traits.criticalChance ? 2 : 1);
      fireForward(s, p.id, p.x, p.y, p.angle, 650, 1.5, damage, p.traits?.piercing);
      if (p.traits?.sideShotDamage) for (const side of [-1, 1]) fireForward(s, p.id, p.x, p.y, p.angle + side * Math.PI / 15, 650, 1.5, damage * p.traits.sideShotDamage, p.traits.piercing);
    }
    if (!p.bot) autoRocket(s, p, dt);
    if (p.y + (boss ? 34 : 22) >= GROUND_Y) p.health = 0;
  }
  if (flight) {
    s.operation!.seconds += dt;
    const scroll = def.scroll * (s.planes[0].boosting ? 1.7 : 1) * dt; s.distance += scroll; s.totalDistance += scroll; s.spawn -= dt;
    s.pickups ??= [];
    for (const pickup of s.pickups) pickup.x -= scroll;
    if (mission!.targetPickups) {
      s.operation!.pickupClock -= dt;
      if (s.operation!.pickupClock <= 0) {
        s.operation!.pickupClock = mission!.seconds / (mission!.targetPickups + 1);
        s.pickups.push({id:++s.seq, x:WIDTH + 40, y:[155, 220, 285][Math.floor(encounterRandom(s) * 3)], kind:mission!.kind === 'supply' ? 'supply' : 'recon'});
      }
    }
    for (const pickup of s.pickups) {
      if (pickup.x < -50) continue;
      const pilot = s.planes[0];
      if (pilot.health > 0 && Math.hypot(pilot.x - pickup.x, pilot.y - pickup.y) <= 42) {
        if (!pickup.retired && pickup.kind === mission!.kind) s.operation!.collected++;
        pickup.x = -200;
        if (pickup.kind === 'supply') pilot.health = Math.min(pilot.hp, pilot.health + pilot.hp * .25);
        fx(s, 'reward', pilot.x, pilot.y, pickup.kind === 'supply' ? 'РЕМОНТ +25%' : 'МАРШРУТ ПРОВЕРЕН');
      }
    }
    s.pickups = s.pickups.filter(pickup => pickup.x > -50);
    s.bombers ??= []; s.bomberClock = (s.bomberClock ?? 18) - dt;
    // A formation enters from offscreen and traverses the upper flight corridor.
    // Track the pilot during approach, then lock the announced carpet so it
    // stays readable while the player has time to evade.
    if (s.level >= 4 && s.bomberClock <= 0 && mission!.kind !== 'recon' && mission!.kind !== 'supply') {
      const {count, bombs, interval} = bomberFormation(s.level);
      for (let i=0; i<count; i++) {
        const dropX = bomberAimDropX(s.planes[0].x, bombs);
        const x = WIDTH + 120 + BOMBER.warningSeconds * BOMBER.speed + Math.floor(bombs / 2) * BOMBER.spacing + i * 240;
        s.bombers.push({id:++s.seq, x, y:BOMBER.altitude, warning:(x - dropX) / BOMBER.speed, dropX, bombs, dropped:0, hp:def.enemyHp * 2.5, aimLocked:false});
      }
      s.bomberClock = interval;
    }
    for (const bomber of s.bombers) {
      bomber.dropped = bombsDropped(bomber); bomber.hp ??= def.enemyHp * 2.5;
      bomber.x -= BOMBER.speed * dt;
      if (bomber.aimLocked === false) {
        bomber.dropX = bomberAimDropX(s.planes[0].x, bomber.bombs);
        bomber.warning = (bomber.x - bomber.dropX) / BOMBER.speed;
        if (bomber.warning <= BOMBER.warningSeconds) bomber.aimLocked = true;
      } else bomber.warning -= dt;
      // Each bomb leaves the moving bay in sequence, forming a horizontal carpet.
      while (bomber.hp > 0 && bomber.dropped < bomber.bombs && bomber.warning + bomber.dropped * BOMBER.spacing / BOMBER.speed <= 0) {
        const x = bomber.dropX - bomber.dropped * BOMBER.spacing;
        s.bullets.push({id:++s.seq, owner:'bomber-' + bomber.id, x, y:bomber.y + BOMBER.bayOffset, vx:0, vy:s.level < 26 ? 150 : 180, life:8, damage:s.planes[0].hp * .5, kind:'bomb'});
        bomber.dropped++;
      }
    }
    s.bombers = s.bombers.filter(bomber => bomber.x > -120 && bomber.hp! > 0);
    const pilot = s.planes[0];
    for (const bomber of s.bombers) if (pilot.health > 0 && !pilot.phaseSeconds && pilot.ram <= 0 && touchesBomber(pilot.x, pilot.y, 22, bomber)) {
      pilot.health -= pilot.hp * .5; pilot.ram = .8; fx(s, 'hit', pilot.x, pilot.y);
    }
    for (const o of s.obstacles) {
      if (o.kind === 'rock' || o.kind === 'pvo') o.y = GROUND_Y;
      o.x -= scroll + (o.kind === 'fighter' || o.kind === 'heavy' ? 65 * dt : 0);
      o.fire -= dt;
    }
    if (s.spawn <= 0) {
      s.spawn = def.spawn * mission!.spacing; const r = encounterRandom(s), encounter = def.encounter;
      const pvoModels = pvoModelsForLevel(s.level);
      const rockChance = mission!.rockChance, pvoChance = mission!.pvoChance, heavyChance = mission!.heavyChance;
      const minY = mission!.aircraftMinY, maxY = mission!.aircraftMaxY;
      const minRock = encounter?.minRockHeight ?? 140, maxRock = encounter?.maxRockHeight ?? 280;
      const kind: Obstacle['kind'] = r < rockChance ? 'rock' : r < rockChance + pvoChance && pvoModels.length ? 'pvo' : r > 1 - heavyChance && s.level >= 6 ? 'heavy' : 'fighter';
      const elite = mission!.kind === 'squadron' && kind === 'heavy' && !s.operation!.specialKills && !s.obstacles.some(o => o.elite && o.hp > 0);
      s.obstacles.push({ id: ++s.seq, kind, x: WIDTH + 80, y: kind === 'pvo' || kind === 'rock' ? GROUND_Y : minY + encounterRandom(s) * (maxY - minY),
        height: kind === 'rock' ? minRock + encounterRandom(s) * (maxRock - minRock) : undefined, pvoModel: kind === 'pvo' ? pvoModels[Math.floor(encounterRandom(s) * pvoModels.length)] : undefined,
        radius: kind === 'rock' ? 72 : kind === 'heavy' ? 32 : 24, hp: kind === 'rock' ? 99999 : def.enemyHp * (elite ? 2.8 : kind === 'heavy' ? 2 : 1), fire: elite ? 2.4 : 1.4, damage: def.enemyDamage, ...(elite ? {elite:true} : {}),
        ...(kind === 'rock' && encounter ? {terrainVariant: Math.floor(encounterRandom(s) * 3)} : {}) });
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
          s.bullets.push({ id: ++s.seq, owner: 'obstacle-' + o.id, x: muzzle.x, y: muzzle.y, vx: Math.cos(muzzle.angle) * 360, vy: Math.sin(muzzle.angle) * 360, life: 4, damage: o.damage }); fx(s, 'shot', muzzle.x, muzzle.y);
        } else {
          // Campaign aircraft face left, matching their mirrored sprites.
          fireForward(s, 'obstacle-' + o.id, o.x, o.y, Math.PI, 360, 4, o.damage);
        }
      }
    }
    s.obstacles = s.obstacles.filter(o => o.x > -130 && o.hp > 0);
    for (const o of s.obstacles) {
      const p = s.planes[0];
      const ground = o.kind === 'rock' || o.kind === 'pvo';
      const touching = ground ? touchesPolygon(p.x, p.y, 22, o.kind === 'rock' ? rockPoints(o) : pvoPoints(o)) : Math.hypot(p.x - o.x, p.y - o.y) < o.radius + 22;
      // Shields and the ram cooldown never allow flying through solid terrain.
      if (p.health > 0 && !p.phaseSeconds && touching && (ground || p.ram <= 0)) { p.health = ground ? 0 : p.health - p.hp * .5; p.ram = .8; fx(s, 'hit', p.x, p.y); }
    }
  }
  for (const b of s.bullets) {
    const fromX = b.x, fromY = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (flight && b.kind === 'bomb' && b.life > 0 && (b.y >= GROUND_Y - 10 || s.obstacles.some(o => o.hp > 0 && (o.kind === 'rock' || o.kind === 'pvo') && touchesPolygon(b.x,b.y,5,o.kind === 'rock' ? rockPoints(o) : pvoPoints(o))))) {
      b.life = 0; fx(s,'explosion',b.x,Math.min(b.y,GROUND_Y - 10));
    }
    for (const p of s.planes) {
      if (p.id === b.owner || p.health <= 0 || p.shield > 0 || b.life <= 0 || b.hitTargets?.includes(p.id)) continue;
      if (p.id === 'boss' ? hitsBoss(p,fromX,fromY,b.x,b.y) : Math.hypot(p.x - b.x, p.y - b.y) < (b.kind === 'bomb' ? 39 : 26)) { p.health -= b.kind === 'bomb' ? p.hp * .5 : b.damage * (1 - (p.traits?.resistance ?? 0)); p.lastAttacker = b.owner; bulletHit(b, p.id); fx(s, b.kind === 'rocket' || b.kind === 'bomb' ? 'explosion' : 'hit', b.x, b.y); }
    }
    if (flight && b.owner === s.planes[0].id && b.life > 0) {
      for (const o of s.obstacles) {
        const touching = o.kind === 'rock' || o.kind === 'pvo' ? touchesPolygon(b.x, b.y, 5, o.kind === 'rock' ? rockPoints(o) : pvoPoints(o)) : Math.hypot(o.x - b.x, o.y - b.y) <= o.radius + 5;
        if (o.hp <= 0 || !touching || b.hitTargets?.includes('obstacle-' + o.id)) continue;
        bulletHit(b, 'obstacle-' + o.id, o.kind === 'rock'); o.hp -= b.damage; fx(s, b.kind === 'rocket' ? 'explosion' : 'hit', b.x, b.y);
        if (o.hp <= 0) {
          s.operation!.kills++;
          if (mission!.kind === 'strike' && o.kind === 'pvo' || mission!.kind === 'convoy' && o.kind === 'heavy' || mission!.kind === 'squadron' && o.elite) s.operation!.specialKills++;
          const multiplier = o.kind === 'pvo' ? 1.25 : o.kind === 'heavy' ? 1.6 : 1;
          const silver = Math.round(def.killSilver * multiplier), xp = Math.round(def.killXp * multiplier);
          award(s, rewards, b.owner, silver, xp, 'kill');
          const paid = rewards.at(-1)!;
          s.operation!.killSilver = (s.operation!.killSilver ?? 0) + paid.silver; s.operation!.killXp = (s.operation!.killXp ?? 0) + paid.xp;
          fx(s, 'explosion', o.x, o.y); fx(s, 'reward', o.x, o.y, '+' + combatReward(campaignReward(silver), s.planes[0].rewardMultiplier ?? 1) + ' серебра');
        }
        if (b.life <= 0) break;
      }
      for (const bomber of s.bombers ?? []) {
        const target = 'bomber-' + bomber.id;
        if (b.life <= 0 || bomber.hp! <= 0 || b.hitTargets?.includes(target) || !touchesBomber(b.x, b.y, 5, bomber)) continue;
        bulletHit(b, target); bomber.hp! -= b.damage; fx(s, 'hit', b.x, b.y);
        if (bomber.hp! <= 0) {
          s.operation!.kills++;
          award(s, rewards, b.owner, Math.round(def.killSilver * 1.6), Math.round(def.killXp * 1.6), 'kill');
          const paid = rewards.at(-1)!;
          s.operation!.killSilver = (s.operation!.killSilver ?? 0) + paid.silver;
          s.operation!.killXp = (s.operation!.killXp ?? 0) + paid.xp;
          fx(s, 'explosion', bomber.x, bomber.y);
        }
      }
    }
  }
  if (flight) s.bombers = s.bombers?.filter(bomber => bomber.hp! > 0);
  s.bullets = s.bullets.filter(b => b.life > 0 && b.x > -50 && b.x < WIDTH + 150 && b.y > (b.kind === 'bomb' ? -100 : 0) && b.y < HEIGHT);
  if (!flight && s.planes.length === 2) {
    const [a, b] = s.planes;
    const touching = a.health > 0 && b.health > 0 && !a.phaseSeconds && !b.phaseSeconds && Math.hypot(a.x - b.x, a.y - b.y) < (s.phase === 'boss' ? 56 : 44);
    if (touching && s.phase === 'boss') {
      a.health = 0; a.lastAttacker = b.id; fx(s, 'hit', a.x, a.y);
    } else if (touching && a.ram <= 0 && b.ram <= 0) {
      a.health -= a.hp * .5; b.health -= b.hp * .5; a.lastAttacker = b.id; b.lastAttacker = a.id; a.ram = b.ram = 1; fx(s, 'hit', a.x, a.y);
    }
  }
  for (const p of s.planes) {
    if (s.mode === 'pve' && !p.bot && p.traits?.emergencyRepair && !p.emergencyUsed && p.health > 0 && p.health < p.hp * .25) {
      p.health = Math.min(p.hp, p.health + p.hp * p.traits.emergencyRepair); p.emergencyUsed = true; fx(s, 'reward', p.x, p.y, 'РЕЗЕРВНЫЙ РЕМОНТ');
    }
    if (p.health > 0 || p.dead > 0) continue;
    p.dead = 2; fx(s, 'explosion', p.x, p.y);
    if (s.mode === 'duel') {
      const other = s.planes.find(x => x.id !== p.id)!; other.score++;
      if (!other.bot && p.lastAttacker === other.id) rewards.push({ player: other.id, silver: 0, xp: 0, kind: 'kill' });
    }
  }
  if (s.mode === 'pve' && s.planes[0].health <= 0) { s.phase = 'ended'; s.result = 'Самолёт потерян'; }
  else if (flight && missionComplete(s.operation!, mission!)) {
    awardSortie(s, rewards);
    s.operation!.completed++;
    if (s.operation!.completed >= operationPlan(s.level).sorties) {
      if (def.boss) approachBoss(s); else nextLevel(s, rewards);
    } else {
      s.phase = 'sortie-reward'; finishSortie(s);
      fx(s, 'level', WIDTH / 2, 150, 'ВЫЛЕТ ' + (s.operation!.completed + 1) + ' · ' + operationMission(s.level, s.operation!.completed).title);
    }
  }
  else if (s.phase === 'boss' && s.planes[1].health <= 0) {
    const b = bossBalance(s.level);
    const bossLevel = s.level;
    award(s, rewards, s.planes[0].id, b.silver, b.xp, 'kill', true, bossLevel); nextLevel(s, rewards);
    s.rewardNextPhase = bossLevel === ZONE.length ? 'ended' : 'flight'; s.rewardBossLevel = bossLevel; s.phase = 'reward'; s.paused = true; s.bullets = [];
  } else if (s.mode === 'duel' && (s.time >= 120 || s.planes.some(p => p.score >= 3))) endDuel(s, rewards);
  return rewards;
}
