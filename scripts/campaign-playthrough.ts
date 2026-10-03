import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ZONE, PLANES, MODULES, freshProfile, planeStats, addExperience, planeUnlocked, MAX_UPGRADE_LEVEL, researchXp, upgradeSilver, type Profile, type Upgrade } from '../shared/data';
import { PHOENIX_PART_LEVELS, PHOENIX_PART_STAGES, phoenixPartRequirements, type PhoenixParts } from '../shared/phoenix';
import { angleDiff, approachBoss, createBattle, finishBossReward, finishSortie, restoreOperationProgress, makePlane, refreshPlaneStats, startBossFight, stepBattle, type Battle, type Controls, type Plane, type Stats } from '../shared/simulation';
import { operationMission, operationPlan, campaignMinimumSeconds, type MissionKind } from '../shared/operations';
import { GROUND_Y, rockPoints, touchesPolygon } from '../shared/terrain';
import { awardBossModifier, chooseModifier, finishCareer, prepareBossAttempt, type CareerAccount } from '../server/career';
import { buyPlane, buyUpgrade, researchUpgrade, buyPhoenixPart } from '../server/economy';
import type { ModifierId, OwnedModifier } from '../shared/modifiers';

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export const DT = 1 / 30;
const missionCache = new Map<string, ReturnType<typeof operationMission>>();
const observedBossMotion = new WeakMap<Battle, {boss: Plane; angle: number; time: number; yaw: number}>();
function cachedMission(level: number, completed: number) {
  const key = level + ':' + completed;
  if (!missionCache.has(key)) missionCache.set(key, operationMission(level, completed));
  return missionCache.get(key)!;
}

/** Uses only visible battlefield data and ordinary controls; never edits combat state. */
export function campaignPilot(s: Battle, scenario: ControlScenario = {}): Controls {
  const p = s.planes[0];
  if (s.phase === 'flight') return flightPilot(s, p);
  if (s.phase !== 'boss') return {turn: 0, fire: false, boost: false};
  return bossPilot(s, p, scenario.sustainedEscape ?? true);
}

function flightPilot(s: Battle, p: Plane): Controls {
  const def = ZONE[s.level - 1], horizon = 1.5;
  const mission = cachedMission(s.level, s.operation?.completed ?? 0);
  const isObjective = (o: Battle['obstacles'][number]) => mission.kind === 'strike' ? o.kind === 'pvo'
    : mission.kind === 'convoy' ? o.kind === 'heavy' : mission.kind === 'squadron' ? !!o.elite : o.kind === 'fighter' || o.kind === 'heavy';
  const target = s.obstacles.filter(o => o.hp > 0 && isObjective(o) && o.x > p.x + 130 && o.x < 1080)
    .sort((a, b) => a.x - b.x)[0];
  const pickup = s.pickups?.filter(o => o.x > p.x - 30 && o.x < 1200).sort((a, b) => a.x - b.x)[0];
  let desiredY = mission.targetPickups && pickup ? pickup.y : target ? mission.kind === 'strike' ? GROUND_Y - 55 : clamp(target.y, 110, 400) : mission.kind === 'strike' ? GROUND_Y - 55 : 220;
  const columns = (s.bombers ?? []).filter(b => b.warning > 0).flatMap(b => Array.from({length: b.bombs}, (_, n) => b.dropX + (n - (b.bombs - 1) / 2) * 70));
  columns.push(...s.bullets.filter(b => b.kind === 'bomb' && b.y < p.y + 65).map(b => b.x));
  const desiredX = columns.length ? [220, 360, 500, 640, 780, 920, 1060].map(x => ({x, score: (x - p.x) ** 2 / 20000 + columns.reduce((n, col) => n + (Math.abs(x - col) < 100 ? (100 - Math.abs(x - col)) * 20 : 0), 0)})).sort((a, b) => a.score - b.score)[0].x : 220;
  const horizontal = Math.abs(desiredX - p.x) < 12 ? 0 : Math.sign(desiredX - p.x);
  // Before the rock reaches the plane, reserve enough room to climb above its tip.
  for (const rock of s.obstacles.filter(o => o.kind === 'rock' && o.x > p.x - 130 && o.x < p.x + def.scroll * 3 + 160)) {
    desiredY = Math.min(desiredY, GROUND_Y - (rock.height ?? 190) - 70);
  }
  let best = 0, score = Infinity;
  for (const turn of [-1, -.5, 0, .5, 1, clamp((desiredY - p.y) / p.speed / .16, -1, 1)]) {
    for (const hold of [.16, horizon]) {
    let cost = 0;
    for (let t = .15; t <= horizon; t += .15) {
      const rawY = p.y + turn * p.speed * Math.min(t, hold);
      const y = clamp(rawY, 75, GROUND_Y - 22);
      // Clamping a forecast at ground height hides the lethal collision.
      // Reserve a small margin and penalize the actual unbounded trajectory.
      if (rawY >= GROUND_Y - 30) cost += 100000 * (horizon - t + .1);
      const pilotX = p.x + horizontal * Math.min(Math.abs(desiredX - p.x), p.speed * t);
      cost += (y - desiredY) ** 2 / (mission.targetPickups && pickup ? 3500 : 13000);
      for (const o of s.obstacles) {
        const x = o.x - (def.scroll + ((o.kind === 'fighter' || o.kind === 'heavy') ? 65 : 0)) * t;
        if (Math.abs(x - pilotX) > 190) continue;
        if (o.kind === 'rock') {
          if (touchesPolygon(pilotX, y, 45, rockPoints({...o, x}))) cost += 2000 * (horizon - t + .1);
        } else if (o.kind === 'pvo') {
          if (Math.abs(x - pilotX) < 85 && y > GROUND_Y - 100) cost += 2000;
        } else if (Math.hypot(x - pilotX, o.y - y) < o.radius + 65) cost += 800 * (horizon - t + .1);
      }
      for (const b of s.bullets) {
        if (b.owner === p.id || b.life < t) continue;
        const distance = Math.hypot(b.x + b.vx * t - pilotX, b.y + b.vy * t - y);
        if (distance < 65) cost += (65 - distance) * (horizon - t + .1) * 7;
      }
    }
    if (cost < score) { score = cost; best = turn; }
    }
  }
  return {turn: best, horizontal, fire: true, boost: false};
}

function bossPilot(s: Battle, p: Plane, sustainedEscape: boolean): Controls {
  const boss = s.planes[1], dx = boss.x - p.x, dy = boss.y - p.y;
  const previous = observedBossMotion.get(s);
  const yaw = previous?.boss === boss && s.time > previous.time ? clamp(angleDiff(boss.angle, previous.angle) / (s.time - previous.time), -boss.turn, boss.turn) : previous?.boss === boss ? previous.yaw : 0;
  observedBossMotion.set(s, {boss, angle: boss.angle, time: s.time, yaw});
  const distance = Math.hypot(dx, dy);
  const targetVx = Math.cos(boss.angle) * boss.speed, targetVy = Math.sin(boss.angle) * boss.speed;
  const a = targetVx ** 2 + targetVy ** 2 - 650 ** 2, b = 2 * (dx * targetVx + dy * targetVy);
  const lead = Math.max(0, (-b - Math.sqrt(Math.max(0, b * b - 4 * a * distance ** 2))) / (2 * a));
  const aim = Math.atan2(dy + Math.sin(boss.angle) * boss.speed * lead, dx + Math.cos(boss.angle) * boss.speed * lead);
  let desired = aim;
  // Leave a safe passing corridor rather than ramming the slower boss.
  if (distance < 250) {
    const away = Math.atan2(-dy, -dx);
    const left = angleDiff(away - .65, p.angle), right = angleDiff(away + .65, p.angle);
    desired = p.angle + (Math.abs(left) < Math.abs(right) ? left : right);
  }
  if (p.y > 450 && Math.sin(p.angle) > -.25) desired = -Math.PI / 2;
  if (p.y < 110 && Math.sin(p.angle) < 0) desired = Math.PI / 2;
  const enemyBullets = s.bullets.filter(b => b.owner !== p.id);
  let best = 0, score = Infinity;
  for (const turn of [-1, -.5, 0, .5, 1, clamp(angleDiff(desired, p.angle) / p.turn / .16, -1, 1)]) {
    // A short steering correction helps aim; a sustained turn is also necessary
    // to escape a boss near the ground. Assuming every turn stops after 0.16s
    // can otherwise reject a safe climbing arc and keep flying into the boss.
    for (const holdDuration of sustainedEscape ? [.16, .8] : [.16]) {
      let x = p.x, y = p.y, angle = p.angle, cost = 0, bx = boss.x, by = boss.y, bossAngle = boss.angle;
      for (let i = 1; i <= 10; i++) {
        const t = i * .08; if (t <= holdDuration + 1e-9) angle += turn * p.turn * .08;
        x = (x + Math.cos(angle) * p.speed * .08 + 1200) % 1200; y += Math.sin(angle) * p.speed * .08;
        if (y < 75) { y = 75; if (Math.sin(angle) < 0) angle = Math.abs(angle); }
        cost += angleDiff(desired, angle) ** 2 * 1.3;
        if (y > 555) cost += (y - 555) ** 2 * 2;
        bossAngle += yaw * .08;
        bx = (bx + Math.cos(bossAngle) * boss.speed * .08 + 1200) % 1200; by += Math.sin(bossAngle) * boss.speed * .08;
        if (by < 75) {by = 75; if (Math.sin(bossAngle) < 0) bossAngle = Math.abs(bossAngle);}
        const separation = Math.hypot(x - bx, y - by);
        // Measured angular velocity follows a turning boss; extra clearance
        // accounts for a route change that cannot yet be observed by the pilot.
        if (separation < 180) cost += (180 - separation) ** 2 * .15;
        for (const b of enemyBullets) {
          if (b.life < t) continue;
          const gap = Math.hypot(b.x + b.vx * t - x, b.y + b.vy * t - y);
          if (gap < 55) cost += (55 - gap) ** 2 * .035;
        }
      }
      if (cost < score) { score = cost; best = turn; }
    }
  }
  return {turn: best, fire: Math.abs(angleDiff(aim, p.angle)) < .35, boost: false};
}

export interface ControlScenario {reactionSeconds?: number; keyboardTurns?: boolean; firingRetention?: number; sustainedEscape?: boolean}
export interface PlaythroughOptions {
  seed: number; endLevel?: number; maxDeaths?: number; maxActiveSeconds?: number; onEvent?: (event: ProgressEvent) => void;
  modifierChoice?: 'priority' | 'first-offer'; upgradePolicy?: 'balanced' | 'none'; paidPhoenix?: boolean; paidGoldBudget?: number; controls?: ControlScenario;
}
export interface ProgressEvent {kind: string; level: number; seconds: number; model: string; silver: number; xp: number; gold?: number; detail: string}
export interface LevelVisit {level: number; seconds: number; phase: 'flight' | 'boss'; outcome: 'passed' | 'lost'; healthRemaining: number; model: string; kills: number; shots: number; triggerPulls: number; landedProjectiles: number; observedHitRate: number; hitFrames: number; damageDealt: number; shotDutyFraction: number; damage: number; hp: number; modifiers: NonNullable<Profile['modifiers']>; firingReference?: {method: string; sustainedDps: number; fortyPercentHitRateSeconds: number}}
export interface PlaythroughResult {
  seed: number; completed: boolean; reachedLevel: number; stoppedReason: string; finalPhase: Battle['phase'];
  activeSeconds: number; flightSeconds: number; bossSeconds: number; deaths: number; bossDeaths: number; rollbacks: number;
  bossVictories: number[]; earned: {silver: number; xp: number}; finalProfile: Profile; timeline: ProgressEvent[]; visits: LevelVisit[];
  scenario: {modifierChoice: 'priority' | 'first-offer'; upgradePolicy: 'balanced' | 'none'; paidGoldCredit: number; controls: ControlScenario};
  missions: MissionVisit[];
  economyCosts?: ReturnType<typeof campaignEconomyCosts>;
}
export interface MissionVisit {level: number; sortie: number; kind: MissionKind; minimumSeconds: number; seconds: number; outcome: 'passed' | 'lost'; kills: number; specialKills: number; collected: number; model: string}

export function campaignEconomyCosts() {
  return Object.fromEntries(PLANES.map(model => [model.id, {price:model.price, currency:model.currency,
    silver:model.id === 'skate' ? [] : Array.from({length:MAX_UPGRADE_LEVEL},(_,i)=>upgradeSilver(i+1,model.id)),
    xp:model.id === 'skate' ? [] : Array.from({length:MAX_UPGRADE_LEVEL},(_,i)=>researchXp(i+1,model.id)),
    ...(model.id === 'skate' ? {goldParts:PHOENIX_PART_STAGES.map(stage => stage.price)} : {}),
    equipment:MODULES.map(module => ({id:module.id, gold:module.price}))}]));
}

/** Fingerprint the actual economy, physics and control policy used by a report. */
export async function campaignSourceFingerprint() {
  const files = ['shared/data.ts', 'shared/simulation.ts', 'shared/operations.ts', 'shared/terrain.ts',
    'shared/modifiers.ts', 'shared/premium.ts', 'shared/skills.ts', 'shared/phoenix.ts', 'shared/equipment.ts',
    'server/economy.ts', 'server/career.ts', 'scripts/campaign-playthrough.ts'];
  const entries = await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex')] as const));
  return Object.fromEntries(entries);
}

/** Input sensitivity model, not a claim about human reaction or ability. */
function sampledPilot(scenario: ControlScenario = {}) {
  let lastBattle: Battle | undefined, lastPhase: Battle['phase'] | undefined, nextDecision = 0;
  let held: Controls = {turn: 0, fire: false, boost: false};
  return (s: Battle): Controls => {
    if (s !== lastBattle || s.phase !== lastPhase || s.time + 1e-9 >= nextDecision) {
      lastBattle = s; lastPhase = s.phase; nextDecision = s.time + Math.max(DT, scenario.reactionSeconds ?? DT);
      held = campaignPilot(s, scenario);
      if (scenario.keyboardTurns) held.turn = Math.abs(held.turn) < .25 ? 0 : Math.sign(held.turn);
      // A reproducible lost-fire window changes Controls only; never edits a hit or bullet.
      const retention = clamp(scenario.firingRetention ?? 1, 0, 1);
      if ((s.time % 3) / 3 >= retention) held.fire = false;
    }
    return {...held};
  };
}

export interface BossScenarioOptions {
  model: typeof PLANES[number]['id']; level: number; seed: number;
  upgrades?: Record<Upgrade, number>; phoenixParts?: PhoenixParts; modifiers?: OwnedModifier[]; controls?: ControlScenario; maxSeconds?: number;
}
export interface BossScenarioResult {
  fixture: true; method: string; options: BossScenarioOptions; stats: Stats;
  outcome: 'won' | 'lost' | 'timeout'; seconds: number; finalPhase: Battle['phase'];
  healthRemaining: number; bossHealthRemaining: number; bossDamageDealt: number; projectilesLaunched: number; damagingFrames: number;
  lossCause?: 'ground' | 'boss-collision' | 'weapon-damage';
}

/** A combat fixture starts at a boss gate; it does not prove the build was economically earned. */
export function runBossScenario(options: BossScenarioOptions): BossScenarioResult {
  if (!ZONE[options.level - 1]?.boss || !Number.isInteger(options.seed)) throw new Error('Choose an existing boss level and integer seed');
  const upgrades = options.upgrades ?? {hull: 0, engine: 0, gun: 0};
  if (Object.values(upgrades).some(n => !Number.isInteger(n) || n < 0 || n > MAX_UPGRADE_LEVEL)) throw new Error('Upgrade fixture levels must be 0..' + MAX_UPGRADE_LEVEL);
  if (options.model === 'skate' && Object.values(upgrades).some(n => n !== 0)) throw new Error('Phoenix uses phoenixParts 0..6, not silver/XP upgrades');
  if (options.model !== 'skate' && options.phoenixParts) throw new Error('Phoenix parts belong only to Phoenix');
  if (options.phoenixParts && (['hull', 'engine', 'gun'] as const).some(branch => !Number.isInteger(options.phoenixParts![branch]) || options.phoenixParts![branch] < 0 || options.phoenixParts![branch] > PHOENIX_PART_LEVELS)) throw new Error('Phoenix part fixture levels must be 0..6');
  const p = freshProfile('boss-fixture-' + options.seed); p.selected = options.model; p.owned = [options.model];
  if (options.model === 'skate') p.phoenixParts = {...options.phoenixParts ?? {hull:0, engine:0, gun:0}};
  else p.upgrades[options.model] = {...upgrades};
  p.modifiers = structuredClone(options.modifiers ?? []);
  const stats = planeStats(p, true), battle = createBattle('boss-fixture-' + options.seed, 'pve', [makePlane(p.id, stats)], options.level);
  approachBoss(battle); startBossFight(battle);
  const boss = battle.planes[1], hp = boss.hp, controller = sampledPilot(options.controls);
  let projectilesLaunched = 0, damagingFrames = 0;
  while (battle.phase === 'boss' && battle.time < (options.maxSeconds ?? 900)) {
    const before = boss.health, beforeShot = battle.planes[0].shot, beforeRocket = battle.planes[0].rocketClock ?? 10;
    stepBattle(battle, {[p.id]: controller(battle)}, DT);
    const pilot = battle.planes[0];
    if (beforeShot <= DT && pilot.shot === .18) projectilesLaunched += 1 + (pilot.traits?.sideShotDamage ? 2 : 0);
    if (beforeRocket < 10 && pilot.rocketClock === 10 && pilot.traits?.rocketDamage) projectilesLaunched++;
    if (boss.health < before) damagingFrames++;
  }
  const pilot = battle.planes[0], lossCause = pilot.health <= 0 ? pilot.y + 22 >= GROUND_Y ? 'ground' : Math.hypot(pilot.x - boss.x, pilot.y - boss.y) < 56 ? 'boss-collision' : 'weapon-damage' : undefined;
  return {fixture: true, method: 'Isolated boss combat fixture with specified aircraft/upgrades/modifiers. Ordinary Controls at 30 Hz, real collisions, bullets and damage. No health/shield edits, debug victories or skipped boss HP. Build availability/purchases are not proven by this fixture; sampled controls are a sensitivity model, not timed human play.', options: structuredClone(options), stats,
    outcome: boss.health <= 0 && battle.planes[0].health > 0 ? 'won' : battle.planes[0].health <= 0 ? 'lost' : 'timeout', seconds: battle.time, finalPhase: battle.phase,
    healthRemaining: Math.max(0, battle.planes[0].health), bossHealthRemaining: Math.max(0, boss.health), bossDamageDealt: hp - Math.max(0, boss.health), projectilesLaunched, damagingFrames, ...(lossCause ? {lossCause} : {})};
}

export function aircraftCombatMatrix() {
  const nextBoss = {universal: 25, swift: 100, yantar: 200, bastion: 250, skate: 250} as const;
  const builds = [{hull: 0, engine: 0, gun: 0}, {hull: 6, engine: 3, gun: 6}, {hull: MAX_UPGRADE_LEVEL, engine: MAX_UPGRADE_LEVEL, gun: MAX_UPGRADE_LEVEL}];
  const parts = [{hull:0, engine:0, gun:0}, {hull:3, engine:2, gun:3}, {hull:6, engine:6, gun:6}];
  const buildFor = (model:string, index:number) => model === 'skate' ? {phoenixParts:parts[index]} : {upgrades:builds[index]};
  const rows = PLANES.flatMap(model => builds.map((_, index) => runBossScenario({model: model.id, level: nextBoss[model.id], seed: 7, ...buildFor(model.id,index)})));
  const controlSensitivity = PLANES.map(model => runBossScenario({model: model.id, level: nextBoss[model.id], seed: 7, ...buildFor(model.id,1), controls: {reactionSeconds: .1, keyboardTurns: true, firingRetention: .85}}));
  const alternateEscape = PLANES.map(model => runBossScenario({model: model.id, level: nextBoss[model.id], seed: 7, ...buildFor(model.id,2), controls: {reactionSeconds: .1, keyboardTurns: true, firingRetention: .85, sustainedEscape: true}}));
  return {qualification: 'Aircraft-specific point fights without modifiers; these are combat fixtures, not earned careers or a human benchmark. Three builds per aircraft plus separate delayed/keyboard input sensitivity and an alternative sustained-turn avoidance policy. Losses/timeouts are reported rather than replaced with cheats.', rows, controlSensitivity, alternateEscape};
}

export function independentCampaignScenarios() {
  const limits = {seed: 7, maxDeaths: 300, maxActiveSeconds: 96 * 3600};
  return {qualification: 'One actual free full career. Alternative card/purchase/input policies are available through runCampaign explicitly; automatically replaying several 43-hour models would repeat millions of equivalent frames. No timed human participants.',
    earnedCareer: runCampaign(limits)};
}

/** Default progression uses earned resources; the paid aircraft scenario declares its gold credit. */
function spendEarned(profile: Profile, level: number, seconds: number, timeline: ProgressEvent[], options: PlaythroughOptions) {
  const event = (kind: string, detail: string) => {
    const row = {kind, level, seconds, model: profile.selected, silver: profile.silver, xp: profile.xp, gold:profile.gold, detail};
    timeline.push(row); options.onEvent?.(row);
  };
  for (let pass = 0; pass < PLANES.length; pass++) {
    const target = [...PLANES].reverse().find(p => p.currency === 'silver' && !profile.owned.includes(p.id) && planeUnlocked(profile, p));
    if (profile.selected !== 'skate' && target && profile.silver >= target.price) { buyPlane(profile, target.id); event('aircraft', target.name); }
    const phoenix = PLANES.find(model => model.id === 'skate')!;
    if (options.paidPhoenix && !profile.owned.includes(phoenix.id) && profile.gold >= phoenix.price && planeUnlocked(profile, phoenix)) { buyPlane(profile, phoenix.id); event('paid-aircraft', phoenix.name); }
    if (options.upgradePolicy === 'none') return;
    if (profile.selected === 'skate') {
      for (const branch of ['gun', 'hull', 'engine'] as const) {
        let request = phoenixPartRequirements(profile, branch);
        while (request.canBuy) {
          buyPhoenixPart(profile, branch, request.level); event('phoenix-part', branch + ' ' + request.level);
          request = phoenixPartRequirements(profile, branch);
        }
      }
      if (Object.values(profile.phoenixParts!).every(n => n === PHOENIX_PART_LEVELS) && !timeline.some(e => e.kind === 'full-upgrade' && e.model === 'skate')) event('full-upgrade', '6/6/6 gold parts');
      return;
    }
    let changed = false;
    while (true) {
      const u = profile.upgrades[profile.selected] ?? {hull:0, engine:0, gun:0};
      const branches: Upgrade[] = ['gun', 'hull', 'engine'];
      branches.sort((a, b) => u[a] - u[b]);
      const branch = branches.find(b => u[b] < MAX_UPGRADE_LEVEL && profile.silver >= upgradeSilver(u[b] + 1, profile.selected) && profile.xp >= researchXp(u[b] + 1, profile.selected));
      if (!branch) break;
      const n = u[branch] + 1;
      researchUpgrade(profile, branch, n); buyUpgrade(profile, branch, n); event('upgrade', branch + ' ' + n); changed = true;
    }
    const u = profile.upgrades[profile.selected];
    if (u && Object.values(u).every(n => n === MAX_UPGRADE_LEVEL) && !timeline.some(e => e.kind === 'full-upgrade' && e.model === profile.selected)) event('full-upgrade', '15/15/15');
    if (!changed) break;
  }
}

const modifierPriority: ModifierId[] = ['field-repair', 'heavy-caliber', 'triple-shot', 'cold-barrel', 'reactive-armor', 'reinforced-hull', 'auto-rocket', 'critical-strike', 'emergency-repair', 'piercing-rounds', 'tailwind', 'fuel-reserve'];

/** Separate weapon fixture, never used to alter progression or win a campaign fight. */
function firingReference(stats: Stats, bossHp: number) {
  const p = makePlane('weapon-reference', {...stats, speed: 0}), s = createBattle('campaign-weapon-reference', 'duel', [p]);
  let launchedDamage = 0;
  for (let frame = 0; frame < 60 * 30; frame++) {
    const seq = s.seq; stepBattle(s, {[p.id]: {turn: 0, fire: true, boost: false}}, DT);
    launchedDamage += s.bullets.filter(b => b.owner === p.id && b.id > seq).reduce((n, b) => n + b.damage, 0);
  }
  const sustainedDps = launchedDamage / 60;
  return {method: 'Separate stationary 60s weapon fixture using the earned build, real heat/critical/triple-shot rules, no target. TTK assumes 40% of launched bullet damage connects and excludes auto-rockets; it is a skill scenario, not a measured boss kill or human result.', sustainedDps, fortyPercentHitRateSeconds: bossHp / (sustainedDps * .4)};
}

export function runCampaign(options: PlaythroughOptions): PlaythroughResult {
  const endLevel = options.endLevel ?? ZONE.length, profile = freshProfile('campaign-measurement-' + options.seed);
  if (!Number.isInteger(options.seed) || !Number.isInteger(endLevel) || endLevel < 1 || endLevel > ZONE.length) throw new Error('Use an integer seed and a campaign end level between 1 and ' + ZONE.length);
  const account: CareerAccount = {profile};
  if (options.paidGoldBudget !== undefined && (!options.paidPhoenix || !Number.isSafeInteger(options.paidGoldBudget) || options.paidGoldBudget < 0)) throw new Error('A non-negative paid gold budget requires the explicit paid Phoenix scenario');
  const paidGoldCredit = options.paidPhoenix ? options.paidGoldBudget ?? PLANES.find(model => model.id === 'skate')!.price : 0;
  profile.gold += paidGoldCredit;
  const result: PlaythroughResult = {seed: options.seed, completed: false, reachedLevel: 1, stoppedReason: '', finalPhase: 'flight', activeSeconds: 0, flightSeconds: 0, bossSeconds: 0, deaths: 0, bossDeaths: 0, rollbacks: 0, bossVictories: [], earned: {silver: 0, xp: 0}, finalProfile: profile, timeline: [], visits: [], missions: [], scenario: {modifierChoice: options.modifierChoice ?? 'priority', upgradePolicy: options.upgradePolicy ?? 'balanced', paidGoldCredit, controls: {reactionSeconds:DT,keyboardTurns:false,firingRetention:1,sustainedEscape:true,...options.controls}}};
  const controller = sampledPilot(options.controls);
  result.economyCosts = campaignEconomyCosts();
  const event = (kind: string, level: number, detail: string) => {
    const row = {kind, level, seconds: result.activeSeconds, model: profile.selected, silver: profile.silver, xp: profile.xp, gold:profile.gold, detail};
    result.timeline.push(row); options.onEvent?.(row);
  };
  let sortie = 0, battle = createBattle('campaign-seed-' + options.seed + '-sortie-' + sortie, 'pve', [makePlane(profile.id, planeStats(profile, true))]);
  let visitLevel = battle.level, visitPhase: 'flight' | 'boss' = 'flight', visitStart = 0, visitKills = 0, visitShots = 0, visitTriggers = 0, visitProjectiles = 0, visitHits = 0, visitDamage = 0, visitModifiers = structuredClone(profile.modifiers ?? []);
  const finishVisit = (outcome: LevelVisit['outcome']) => {
    const p = battle.planes[0], seconds = result.activeSeconds - visitStart;
    result.visits.push({level: visitLevel, phase: visitPhase, seconds, outcome, healthRemaining: Math.max(0, p.health), model: p.model, kills: visitKills, shots: visitShots, triggerPulls: visitTriggers, landedProjectiles: visitProjectiles, observedHitRate: visitShots ? visitProjectiles / visitShots : 0, hitFrames: visitHits, damageDealt: visitDamage, shotDutyFraction: seconds ? visitTriggers * .18 / seconds : 0, damage: p.damage, hp: p.hp, modifiers: visitModifiers, ...(visitPhase === 'boss' ? {firingReference: firingReference(p, ZONE[visitLevel - 1].boss!.hp)} : {})});
    visitStart = result.activeSeconds; visitKills = 0; visitShots = 0; visitTriggers = 0; visitProjectiles = 0; visitHits = 0; visitDamage = 0;
  };
  spendEarned(profile, 1, 0, result.timeline, options);
  refreshPlaneStats(battle.planes[0], planeStats(profile, true));
  while (result.activeSeconds < (options.maxActiveSeconds ?? 96 * 3600)) {
    result.reachedLevel = Math.max(result.reachedLevel, battle.level);
    if (battle.phase === 'sortie-reward') {
      spendEarned(profile, battle.level, result.activeSeconds, result.timeline, options);
      refreshPlaneStats(battle.planes[0], planeStats(profile, true)); finishSortie(battle);
      visitLevel = battle.level; visitPhase = 'flight'; visitStart = result.activeSeconds;
      visitModifiers = structuredClone(profile.modifiers ?? []);
    }
    if (battle.phase === 'boss-intro') {
      spendEarned(profile, battle.level, result.activeSeconds, result.timeline, options);
      refreshPlaneStats(battle.planes[0], planeStats(profile, true));
      prepareBossAttempt(account, battle); startBossFight(battle);
      visitLevel = battle.level; visitPhase = 'boss'; visitStart = result.activeSeconds;
      visitModifiers = structuredClone(profile.modifiers ?? []);
      event('boss-start', battle.level, 'attempt ' + battle.bossAttempt);
    }
    const previousLevel = battle.level, previousPhase = battle.phase, beforeShot = battle.planes[0].shot, beforeRocketClock = battle.planes[0].rocketClock ?? 10;
    const operation = previousPhase === 'flight' ? battle.operation : undefined;
    const operationIndex = operation?.completed ?? 0;
    const mission = operation ? cachedMission(previousLevel, operationIndex) : undefined;
    const boss = previousPhase === 'boss' ? battle.planes[1] : undefined, beforeBossHp = boss?.health ?? 0;
    const projectiles = boss ? battle.bullets.filter(b => b.owner === profile.id && !b.hitTargets?.includes('boss')) : [];
    const rewards = stepBattle(battle, {[profile.id]: controller(battle)}, DT);
    const p = battle.planes[0];
    if (beforeShot <= DT && p.shot === .18) { visitTriggers++; visitShots += 1 + (p.traits?.sideShotDamage ? 2 : 0); }
    if (beforeRocketClock < 10 && p.rocketClock === 10 && p.traits?.rocketDamage) visitShots++;
    visitProjectiles += projectiles.filter(b => b.hitTargets?.includes('boss')).length;
    if (boss && boss.health < beforeBossHp) { visitHits++; visitDamage += beforeBossHp - Math.max(0, boss.health); }
    result.activeSeconds += DT;
    if (previousPhase === 'flight') result.flightSeconds += DT;
    if (previousPhase === 'boss') result.bossSeconds += DT;
    for (const reward of rewards) {
      profile.silver += reward.silver; addExperience(profile, reward.xp);
      result.earned.silver += reward.silver; result.earned.xp += reward.xp;
      if (reward.kind === 'kill') visitKills++;
      if (reward.bossLevel) {
        if (!profile.defeatedBosses!.includes(reward.bossLevel)) profile.defeatedBosses!.push(reward.bossLevel);
        account.bossFailures = undefined;
        result.bossVictories.push(reward.bossLevel);
        const offer = awardBossModifier(account, reward.bossLevel, battle.id)!;
        const pick = options.modifierChoice === 'first-offer' ? offer.options[0] : modifierPriority.find(id => offer.options.includes(id))!;
        chooseModifier(account, offer.id, pick); event('modifier', reward.bossLevel, pick);
      }
    }
    const sortieCompleted = rewards.some(reward => reward.kind === 'sortie');
    const recordMission = (outcome: MissionVisit['outcome']) => {
      if (operation && mission) result.missions.push({level: previousLevel, sortie: operationIndex + 1, kind: mission.kind, minimumSeconds: mission.seconds, seconds: result.activeSeconds - visitStart, outcome, kills: operation.kills, specialKills: operation.specialKills, collected: operation.collected, model: battle.planes[0].model});
    };
    if (sortieCompleted) {
      recordMission('passed'); finishVisit('passed'); event('sortie', previousLevel, (operationIndex + 1) + '/' + operationPlan(previousLevel).sorties + ' ' + mission!.kind);
    }
    if (battle.phase === 'reward') {
      finishVisit('passed'); event('boss-win', previousLevel, 'HP ' + Math.round(battle.planes[0].health));
      refreshPlaneStats(battle.planes[0], planeStats(profile, true)); finishBossReward(battle);
      if ((battle as Battle).phase !== 'ended') { spendEarned(profile, battle.level, result.activeSeconds, result.timeline, options); refreshPlaneStats(battle.planes[0], planeStats(profile, true)); }
      if (previousLevel >= endLevel) { result.completed = true; result.stoppedReason = 'final boss defeated'; break; }
      visitLevel = battle.level; visitPhase = 'flight'; visitStart = result.activeSeconds;
      visitModifiers = structuredClone(profile.modifiers ?? []);
    } else if (battle.phase === 'ended' && battle.planes[0].health <= 0) {
      recordMission('lost');
      finishVisit('lost'); result.deaths++; if (previousPhase === 'boss') result.bossDeaths++;
      finishCareer(account, battle); if (battle.bossAttemptsExhausted) result.rollbacks++;
      const cause=battle.planes[0].y+22>=GROUND_Y?'ground':battle.planes[0].lastAttacker==='boss'&&Math.hypot(battle.planes[0].x-(boss?.x??0),battle.planes[0].y-(boss?.y??0))<60?'boss-collision':'weapon/obstacle';
      event('death', previousLevel, (battle.bossAttemptsExhausted ? 'rollback to ' + account.restartLevel : 'retry') + ', phase ' + previousPhase+', '+cause+', x '+battle.planes[0].x.toFixed(2)+' y '+battle.planes[0].y.toFixed(2));
      if (result.deaths >= (options.maxDeaths ?? 300)) { result.stoppedReason = 'death limit'; break; }
      spendEarned(profile, account.restartLevel ?? previousLevel, result.activeSeconds, result.timeline, options);
      battle = createBattle('campaign-seed-' + options.seed + '-sortie-' + ++sortie, 'pve', [makePlane(profile.id, planeStats(profile, true))], account.restartLevel ?? previousLevel);
      if (account.operationCheckpoint?.level === battle.level) restoreOperationProgress(battle, account.operationCheckpoint.completed);
      if (account.restartBoss) { approachBoss(battle); prepareBossAttempt(account, battle); }
      visitLevel = battle.level; visitPhase = account.restartBoss ? 'boss' : 'flight'; visitStart = result.activeSeconds;
      visitModifiers = structuredClone(profile.modifiers ?? []);
    } else if (battle.level !== previousLevel) {
      if (!sortieCompleted) finishVisit('passed'); event('level', previousLevel, 'passed');
      if (previousLevel >= endLevel) { result.completed = true; result.stoppedReason = 'requested level passed'; break; }
      visitLevel = battle.level; visitPhase = 'flight'; visitStart = result.activeSeconds;
    }
  }
  if (!result.stoppedReason) result.stoppedReason = 'active time limit';
  result.finalPhase = battle.phase;
  return result;
}

export function campaignMilestones(run: PlaythroughResult) {
  return PLANES.map(model => {
    const purchase = run.timeline.find(e => ['aircraft', 'paid-aircraft'].includes(e.kind) && e.model === model.id);
    const full = run.timeline.find(e => e.kind === 'full-upgrade' && e.model === model.id);
    return {id: model.id, name: model.name, currency: model.currency, unlockBoss: model.unlockBoss,
      nativeMinimumSeconds: campaignMinimumSeconds(model.unlockBoss),
      acquired: run.finalProfile.owned.includes(model.id),
      acquiredAtSeconds: model.id === 'universal' ? 0 : purchase?.seconds ?? null,
      acquiredAtLevel: model.id === 'universal' ? 1 : purchase?.level ?? null,
      fullyUpgradedAtSeconds: full?.seconds ?? null, fullyUpgradedAtLevel: full?.level ?? null};
  });
}

export function campaignEconomyTimeline(run: PlaythroughResult) {
  const costs=run.economyCosts ?? campaignEconomyCosts();
  return campaignMilestones(run).filter(m=>m.acquired).map(m=>{
    const startIndex=run.timeline.findIndex(e=>['aircraft','paid-aircraft'].includes(e.kind)&&e.model===m.id);
    const nextIndex=run.timeline.findIndex((e,index)=>index>startIndex&&['aircraft','paid-aircraft'].includes(e.kind)&&e.model!==m.id);
    const start=startIndex<0?undefined:run.timeline[startIndex],next=nextIndex<0?undefined:run.timeline[nextIndex];
    const events=run.timeline.slice(Math.max(0,startIndex),nextIndex<0?undefined:nextIndex).filter(e=>e.model===m.id);
    const last=events.at(-1),cost=costs[m.id];
    const upgrades=events.filter(e=>e.kind==='upgrade'||e.kind==='phoenix-part');
    const gaps=upgrades.slice(1).map((e,index)=>e.seconds-upgrades[index].seconds).sort((a,b)=>a-b);
    const stops=[...new Set(upgrades.map(e=>e.seconds))],stopGaps=stops.slice(1).map((seconds,index)=>seconds-stops[index]).sort((a,b)=>a-b);
    const median=(values:number[])=>values.length?values.length%2?values[Math.floor(values.length/2)]:(values[values.length/2-1]+values[values.length/2])/2:0;
    const spent=upgrades.reduce((sum,e)=>{
      const level=Number(e.detail.split(' ')[1]);
      return {silver:sum.silver+(e.kind==='phoenix-part'?0:cost.silver[level-1]),xp:sum.xp+(e.kind==='phoenix-part'?0:cost.xp[level-1]),gold:sum.gold+(e.kind==='phoenix-part'?cost.goldParts![level-1]:0)};
    },{silver:0,xp:0,gold:0});
    const endSeconds=next?.seconds??run.activeSeconds,endSilver=next ? (last?.silver??0) : run.finalProfile.silver,endXp=next ? (last?.xp??0) : run.finalProfile.xp;
    const startSilver=start?.silver??200,startXp=start?.xp??0;
    return {...m,startSilver,startXp,endSeconds,endSilver,endXp,upgradeSpending:spent,
      earnedWhileOwned:{silver:endSilver-startSilver+spent.silver,xp:endXp-startXp+spent.xp},
      upgradeCadence:{purchases:upgrades.length,distinctStops:stops.length,firstAtSeconds:upgrades[0]?.seconds??null,lastAtSeconds:upgrades.at(-1)?.seconds??null,
        medianPurchaseGapSeconds:median(gaps),longestPurchaseGapSeconds:Math.max(0,...gaps),medianStopGapSeconds:median(stopGaps),longestStopGapSeconds:Math.max(0,...stopGaps)},
      progressionPlateauSeconds:m.fullyUpgradedAtSeconds===null?0:Math.max(0,endSeconds-m.fullyUpgradedAtSeconds)};
  });
}

/** Verifies the measured route, objectives and earned wallet without replaying it. */
export function auditCampaign(run: PlaythroughResult) {
  const errors:string[]=[],passed=run.missions.filter(m=>m.outcome==='passed');
  const costs=run.economyCosts??campaignEconomyCosts();
  for (const m of passed) {
    const mission=cachedMission(m.level,m.sortie-1);
    if(m.seconds+1e-4<mission.seconds||m.kills<mission.targetKills||m.specialKills<mission.targetSpecial||m.collected<mission.targetPickups) errors.push('Missing duration/objective at '+m.level+'/'+m.sortie);
  }
  if(run.completed) {
    for(let level=1;level<=run.reachedLevel;level++) {
      for(let sortie=1;sortie<=operationPlan(level).sorties;sortie++) if(!passed.some(m=>m.level===level&&m.sortie===sortie)) errors.push('Missing mission '+level+'/'+sortie);
      if(ZONE[level-1].boss&&!run.bossVictories.includes(level)) errors.push('Missing boss victory '+level);
    }
    if(run.reachedLevel===ZONE.length&&run.finalPhase!=='ended') errors.push('Full campaign must end after the final card choice');
    if(run.flightSeconds+1e-4<campaignMinimumSeconds(run.reachedLevel)) errors.push('Campaign ran faster than native mission duration');
  }
  let silver=200+run.earned.silver,xp=run.earned.xp,gold=run.scenario.paidGoldCredit;
  for(const model of run.finalProfile.owned) { const cost=costs[model]; if(cost.currency==='silver')silver-=cost.price;else gold-=cost.price; }
  for(const [model,build] of Object.entries(run.finalProfile.upgrades)) for(const level of Object.values(build)) {
    silver-=costs[model].silver.slice(0,level).reduce((n,v)=>n+v,0); xp-=costs[model].xp.slice(0,level).reduce((n,v)=>n+v,0);
  }
  const phoenixGold = costs.skate.goldParts;
  if(phoenixGold && run.finalProfile.owned.includes('skate')) for(const level of Object.values(run.finalProfile.phoenixParts ?? {hull:0,engine:0,gun:0})) gold-=phoenixGold.slice(0,level).reduce((n,v)=>n+v,0);
  for(const [model,equipment] of Object.entries(run.finalProfile.planeEquipment ?? {})) for(const id of equipment.owned) {
    const module=costs[model].equipment?.find(item=>item.id===id);
    if(!module)errors.push('Unknown purchased equipment '+model+'/'+id);else gold-=module.gold;
  }
  if(silver!==run.finalProfile.silver||xp!==run.finalProfile.xp||gold!==run.finalProfile.gold||run.earned.xp!==run.finalProfile.totalXp) errors.push('Earned wallet does not reconcile with aircraft and upgrades');
  const completedBosses=new Set<number>(),fullAircraft=new Set<string>();
  for(const event of run.timeline) {
    if(event.kind==='boss-win')completedBosses.add(event.level);
    if(event.kind==='full-upgrade')fullAircraft.add(event.model);
    if(['aircraft','paid-aircraft'].includes(event.kind)) {
      const model=PLANES.find(p=>p.id===event.model)!;
      const previous=PLANES.filter(p=>p.currency==='silver').find((p,index,list)=>list[index+1]?.id===model.id);
      if(model.unlockBoss&&!completedBosses.has(model.unlockBoss)) errors.push('Aircraft purchased before boss '+model.unlockBoss);
      if(model.currency==='silver'&&previous&&!fullAircraft.has(previous.id)) errors.push('Aircraft purchased before full predecessor '+previous.id);
    }
    if(event.kind==='phoenix-part') {
      const level=Number(event.detail.split(' ')[1]),stage=PHOENIX_PART_STAGES[level-1];
      if(!stage||!completedBosses.has(stage.bossLevel))errors.push('Phoenix part purchased before its boss gate: '+event.detail);
    }
  }
  return {passed:errors.length===0,errors,missionAttempts:run.missions.length,successfulMissions:passed.length,
    distinctMissionKinds:[...new Set(passed.map(m=>m.kind))],bossVictories:run.bossVictories,
    minimumFlightSeconds:campaignMinimumSeconds(run.reachedLevel),wallet:{silver,xp,gold},aircraftEconomy:campaignEconomyTimeline(run)};
}

export function estimateHumanTime(runs: PlaythroughResult[]) {
  const complete = runs.filter(r => r.completed);
  if (!complete.length) return undefined;
  const mean = (f: (r: PlaythroughResult) => number) => complete.reduce((n, r) => n + f(r), 0) / complete.length;
  const active = mean(r => r.activeSeconds), flights = mean(r => r.flightSeconds), bosses = mean(r => r.bossSeconds);
  const passedMissions = mean(r => r.missions.filter(m => m.outcome === 'passed').length);
  const native = mean(r => campaignMinimumSeconds(r.reachedLevel));
  const purchases = mean(r => r.timeline.filter(e => ['upgrade', 'phoenix-part', 'aircraft', 'paid-aircraft'].includes(e.kind)).length);
  const intermissions=mean(r=>ZONE.slice(0,r.reachedLevel).reduce((n,z)=>n+operationPlan(z.level).sorties-1,0));
  const operations=mean(r=>r.reachedLevel);
  const briefings=intermissions*2+operations*3,decisions=mean(r => r.bossVictories.length)*35+purchases*15;
  const menus = briefings + decisions;
  const noviceMenus=intermissions*5+operations*6+decisions*1.5;
  const tutorials = 120;
  const skillScenarioBossSeconds = mean(r => r.visits.filter(v => v.phase === 'boss' && v.outcome === 'passed').reduce((n, v) => n + (v.firingReference?.fortyPercentHitRateSeconds ?? v.seconds), 0));
  const noviceBossSeconds = skillScenarioBossSeconds * .4 / .15;
  const nominalFlights = mean(r => {
    const firstPassed=new Map<string,number>();
    for(const m of r.missions)if(m.outcome==='passed'&&!firstPassed.has(m.level+':'+m.sortie))firstPassed.set(m.level+':'+m.sortie,m.seconds);
    return [...firstPassed.values()].reduce((n,seconds)=>n+seconds,0);
  });
  // Missions have a native duration floor. Additional objective time, retries,
  // aiming and menus remain scenarios; no timed human participants are implied.
  return {basis: 'Scenario estimate; no human participants were timed. Excludes real-life breaks. Autopilot knows visible positions precisely; input limits and purchase/card policies are declared per run rather than claimed to reproduce human skill.',
    nativeMissionSeconds: native, nativeMissionHours: native / 3600,
    automatedActiveSeconds: active, flightSeconds: flights, bossSeconds: bosses, firstSuccessfulMissionSeconds: nominalFlights,
    automatedMissionOverrunSeconds: flights - native,
    menuAssumptions: {secondsPerIntermission:{experienced:2,firstTime:5},secondsPerOperationBriefing:{experienced:3,firstTime:6},secondsPerBossCard:35,secondsPerPurchase:15,passedMissions,intermissions,operations,purchases,briefingsSeconds:briefings,decisionsSeconds:decisions},
    milestones: complete.map(r => ({seed: r.seed, aircraft: campaignMilestones(r)})),
    modeledScenarios: complete.map(r => ({seed: r.seed, ...r.scenario})),
    excludedIncompleteRuns: runs.filter(r => !r.completed).map(r => ({seed: r.seed, reachedLevel: r.reachedLevel, reason: r.stoppedReason, activeSeconds: r.activeSeconds, deaths: r.deaths, scenario: r.scenario})),
    sustainedFortyPercentAimScenario: {bossSeconds: skillScenarioBossSeconds, menusSeconds: menus, tutorialSeconds: tutorials, totalHours: (flights + skillScenarioBossSeconds + menus + tutorials) / 3600, qualification: 'Optimistic weapon-throughput scenario with the same earned builds and flight deaths. Assumes sustained 40% useful bullet damage, not the measured cautious autopilot firing duty. No timed human data.'},
    experienced: {usefulWeaponDamageFraction:.4,bossSeconds:skillScenarioBossSeconds,extraRetriesSeconds:.02*native,menusSeconds:menus,tutorialSeconds:tutorials,totalHours:(nominalFlights+skillScenarioBossSeconds+.02*native+menus+tutorials)/3600},
    firstTime: {usefulWeaponDamageFraction:.15,bossSeconds:noviceBossSeconds,extraRetriesSeconds:.12*native,menusSeconds:noviceMenus,tutorialSeconds:tutorials,totalHours:(nominalFlights+noviceBossSeconds+.12*native+noviceMenus+tutorials)/3600},
    qualification:'Human budgets assume 40%/15% useful sustained weapon damage (including lost firing/aiming time), 2%/12% additional native mission time for retries, and explicit menu time. The first successful instance of each mission supplies objective overrun; automated rollbacks and cautious bot boss time are not multiplied into a human benchmark. Weapon references use the observed earned builds and exclude auto-rocket throughput. Economic affordability for lower kill rates must be assessed independently.',
    cautiousAutopilotSensitivity:{bossMultiplier:1.25,extraRetriesSeconds:.05*active,totalHours:(flights+bosses*1.25+.05*active+menus+tutorials)/3600,qualification:'Sensitivity around this specific cautious automated control policy; not a human timing estimate.'},
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sourceBefore = await campaignSourceFingerprint();
  const seeds = (process.env.CAMPAIGN_SEEDS ?? '7').split(',').map(Number), endLevel = Number(process.env.CAMPAIGN_END ?? ZONE.length);
  const runs = seeds.map(seed => runCampaign({seed, endLevel, onEvent: e => {
    if (['boss-start', 'boss-win', 'death', 'aircraft', 'paid-aircraft', 'full-upgrade'].includes(e.kind)) console.log('seed', seed, e.kind, e.level, Math.round(e.seconds) + 's', e.model, e.detail);
  }}));
  const report = {generatedAt: new Date().toISOString(), version: 'v0.8', levels: endLevel, timestep: DT, nativeMinimumSeconds: campaignMinimumSeconds(endLevel), method: 'Authoritative stepBattle at 30 Hz, only ordinary player controls. Every mission timer and kill/special-target/pickup objective completes through real movement and hits; boss HP is actually defeated. Economy starts with freshProfile: 200 silver / 0 XP / 0 gold; research and purchases use server helpers, including full predecessor aircraft and boss gates. Boss choices are drawn from actual earned offers. Ordinary deaths restore only the official completed-sortie checkpoint; three boss losses use the real stage rollback. No debug commands, skipped fights, HP/shield edits, extra immunity, premium, tasks, ads or login bonuses. Standard spawn shields and intermission/level repairs are applied only by gameplay helpers. Menus are instant in automation and included as explicit human-estimate assumptions.', metrics: 'shots counts launched primary/side/rocket projectiles. triggerPulls counts primary weapon discharges. landedProjectiles counts observed first impacts against the boss; a newly launched projectile removed in the same frame can be absent, so observedHitRate is a lower bound. hitFrames counts simulation frames with boss damage, which can contain several impacts. shotDutyFraction uses triggerPulls times 0.18s/visit duration. healthRemaining is the observed post-step value and includes a normal repair when stepBattle transitions into the next level; it is not a pre-repair damage gauge. Firing references are isolated stationary weapon fixtures, never campaign victories.', runs, audits:runs.map(auditCampaign), humanEstimate: estimateHumanTime(runs)};
  const sourceAfter = await campaignSourceFingerprint();
  const source = {files:sourceBefore, unchangedDuringRun:JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter)};
  const currentReport = {...report, version:'v0.9', source};
  await mkdir('design-review', {recursive: true}); await writeFile('design-review/campaign-v09-playthrough.json', JSON.stringify(currentReport, null, 2) + '\n');
  console.log(JSON.stringify({runs: runs.map(r => ({seed:r.seed,completed:r.completed,reachedLevel:r.reachedLevel,finalPhase:r.finalPhase,activeSeconds:r.activeSeconds,deaths:r.deaths,missionAttempts:r.missions.length,bossVictories:r.bossVictories,aircraft:campaignMilestones(r)})),humanEstimate: report.humanEstimate}, null, 2));
  if (runs.some(r => !r.completed)||report.audits.some(a=>!a.passed)||!source.unchangedDuringRun) process.exitCode = 1;
}
