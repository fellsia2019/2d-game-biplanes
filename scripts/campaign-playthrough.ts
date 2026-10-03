import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ZONE, PLANES, freshProfile, planeStats, addExperience, planeUnlocked, RESEARCH_XP, upgradeSilver, type Profile, type Upgrade } from '../shared/data';
import { angleDiff, approachBoss, createBattle, finishBossReward, makePlane, refreshPlaneStats, startBossFight, stepBattle, type Battle, type Controls, type Plane, type Stats } from '../shared/simulation';
import { GROUND_Y, rockPoints, touchesPolygon } from '../shared/terrain';
import { awardBossModifier, chooseModifier, finishCareer, prepareBossAttempt, type CareerAccount } from '../server/career';
import { buyPlane, buyUpgrade, researchUpgrade } from '../server/economy';
import type { ModifierId, OwnedModifier } from '../shared/modifiers';

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export const DT = 1 / 30;

/** Uses only visible battlefield data and ordinary controls; never edits combat state. */
export function campaignPilot(s: Battle, scenario: ControlScenario = {}): Controls {
  const p = s.planes[0];
  if (s.phase === 'flight') return flightPilot(s, p);
  if (s.phase !== 'boss') return {turn: 0, fire: false, boost: false};
  return bossPilot(s, p, scenario.sustainedEscape ?? false);
}

function flightPilot(s: Battle, p: Plane): Controls {
  const def = ZONE[s.level - 1], horizon = 1.5;
  const target = s.obstacles.filter(o => o.hp > 0 && (o.kind === 'fighter' || o.kind === 'heavy') && o.x > p.x + 100 && o.x < 1080)
    .sort((a, b) => a.x - b.x)[0];
  let desiredY = target ? clamp(target.y, 110, 400) : 220;
  // Before the rock reaches the plane, reserve enough room to climb above its tip.
  for (const rock of s.obstacles.filter(o => o.kind === 'rock' && o.x > p.x - 130 && o.x < p.x + def.scroll * 3 + 160)) {
    desiredY = Math.min(desiredY, GROUND_Y - (rock.height ?? 190) - 70);
  }
  let best = 0, score = Infinity;
  for (const turn of [-1, -.5, 0, .5, 1]) {
    let cost = 0;
    for (let t = .15; t <= horizon; t += .15) {
      const y = clamp(p.y + turn * p.speed * t, 75, GROUND_Y - 22);
      cost += (y - desiredY) ** 2 / 13000;
      for (const o of s.obstacles) {
        const x = o.x - (def.scroll + ((o.kind === 'fighter' || o.kind === 'heavy') ? 65 : 0)) * t;
        if (Math.abs(x - p.x) > 190) continue;
        if (o.kind === 'rock') {
          if (touchesPolygon(p.x, y, 45, rockPoints({...o, x}))) cost += 2000 * (horizon - t + .1);
        } else if (o.kind === 'pvo') {
          if (Math.abs(x - p.x) < 85 && y > GROUND_Y - 100) cost += 2000;
        } else if (Math.hypot(x - p.x, o.y - y) < o.radius + 65) cost += 800 * (horizon - t + .1);
      }
      for (const b of s.bullets) {
        if (b.owner === p.id || b.life < t) continue;
        const distance = Math.hypot(b.x + b.vx * t - p.x, b.y + b.vy * t - y);
        if (distance < 65) cost += (65 - distance) * (horizon - t + .1) * 7;
      }
    }
    if (cost < score) { score = cost; best = turn; }
  }
  return {turn: best, horizontal: p.x > 225 ? -1 : 0, fire: true, boost: false};
}

function bossPilot(s: Battle, p: Plane, sustainedEscape: boolean): Controls {
  const boss = s.planes[1], dx = boss.x - p.x, dy = boss.y - p.y;
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
      let x = p.x, y = p.y, angle = p.angle, cost = 0;
      for (let i = 1; i <= 10; i++) {
        const t = i * .08; if (t <= holdDuration + 1e-9) angle += turn * p.turn * .08;
        x = (x + Math.cos(angle) * p.speed * .08 + 1200) % 1200; y += Math.sin(angle) * p.speed * .08;
        if (y < 75) { y = 75; if (Math.sin(angle) < 0) angle = Math.abs(angle); }
        cost += angleDiff(desired, angle) ** 2 * 1.3;
        if (y > 555) cost += (y - 555) ** 2 * 2;
        const bx = (boss.x + Math.cos(boss.angle) * boss.speed * t + 1200) % 1200, by = boss.y + Math.sin(boss.angle) * boss.speed * t;
        const separation = Math.hypot(x - bx, y - by);
        if (separation < 130) cost += (130 - separation) ** 2 * .04;
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
  modifierChoice?: 'priority' | 'first-offer'; upgradePolicy?: 'balanced' | 'none'; paidPhoenix?: boolean; controls?: ControlScenario;
}
export interface ProgressEvent {kind: string; level: number; seconds: number; model: string; silver: number; xp: number; detail: string}
export interface LevelVisit {level: number; seconds: number; phase: 'flight' | 'boss'; outcome: 'passed' | 'lost'; healthRemaining: number; model: string; kills: number; shots: number; triggerPulls: number; landedProjectiles: number; observedHitRate: number; hitFrames: number; damageDealt: number; shotDutyFraction: number; damage: number; hp: number; modifiers: NonNullable<Profile['modifiers']>; firingReference?: {method: string; sustainedDps: number; fortyPercentHitRateSeconds: number}}
export interface PlaythroughResult {
  seed: number; completed: boolean; reachedLevel: number; stoppedReason: string; finalPhase: Battle['phase'];
  activeSeconds: number; flightSeconds: number; bossSeconds: number; deaths: number; bossDeaths: number; rollbacks: number;
  bossVictories: number[]; earned: {silver: number; xp: number}; finalProfile: Profile; timeline: ProgressEvent[]; visits: LevelVisit[];
  scenario: {modifierChoice: 'priority' | 'first-offer'; upgradePolicy: 'balanced' | 'none'; paidGoldCredit: number; controls: ControlScenario};
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
  upgrades?: Record<Upgrade, number>; modifiers?: OwnedModifier[]; controls?: ControlScenario; maxSeconds?: number;
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
  if (Object.values(upgrades).some(n => !Number.isInteger(n) || n < 0 || n > 5)) throw new Error('Upgrade fixture levels must be 0..5');
  const p = freshProfile('boss-fixture-' + options.seed); p.selected = options.model; p.owned = [options.model];
  p.upgrades[options.model] = {...upgrades}; p.modifiers = structuredClone(options.modifiers ?? []);
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
  const nextBoss = {universal: 10, swift: 25, yantar: 50, bastion: 250, skate: 250} as const;
  const builds = [{hull: 0, engine: 0, gun: 0}, {hull: 2, engine: 1, gun: 2}, {hull: 5, engine: 5, gun: 5}];
  const rows = PLANES.flatMap(model => builds.map(upgrades => runBossScenario({model: model.id, level: nextBoss[model.id], seed: 7, upgrades})));
  const controlSensitivity = PLANES.map(model => runBossScenario({model: model.id, level: nextBoss[model.id], seed: 7, upgrades: {hull: 2, engine: 1, gun: 2}, controls: {reactionSeconds: .1, keyboardTurns: true, firingRetention: .85}}));
  const alternateEscape = [runBossScenario({model: 'yantar', level: 50, seed: 7, upgrades: {hull: 5, engine: 5, gun: 5}, controls: {sustainedEscape: true}}),
    ...PLANES.map(model => runBossScenario({model: model.id, level: nextBoss[model.id], seed: 7, upgrades: {hull: 2, engine: 1, gun: 2}, controls: {reactionSeconds: .1, keyboardTurns: true, firingRetention: .85, sustainedEscape: true}}))];
  return {qualification: 'Aircraft-specific point fights without modifiers; these are combat fixtures, not earned careers or a human benchmark. Three builds per aircraft plus separate delayed/keyboard input sensitivity and an alternative sustained-turn avoidance policy. Losses/timeouts are reported rather than replaced with cheats.', rows, controlSensitivity, alternateEscape};
}

export function independentCampaignScenarios() {
  const limits = {seed: 7, maxDeaths: 80, maxActiveSeconds: 6 * 3600};
  return {qualification: 'Alternative earned careers, separate from the original three-run report. first-offer chooses the first actual card without ranking its benefit. paidPhoenix assumes one credited 300 gold purchase and obeys the real boss 50 unlock/purchase helper; it does not verify a platform receipt. earlyNoUpgrade ends after boss 50. sampledKeyboard is a bounded input-sensitivity experiment, not a measured human.',
    firstOffer: runCampaign({...limits, modifierChoice: 'first-offer'}),
    earlyNoUpgrade: runCampaign({...limits, endLevel: 50, modifierChoice: 'first-offer', upgradePolicy: 'none'}),
    paidPhoenix: runCampaign({...limits, paidPhoenix: true}),
    sampledKeyboard: runCampaign({...limits, modifierChoice: 'first-offer', controls: {reactionSeconds: .1, keyboardTurns: true, firingRetention: .85, sustainedEscape: true}})};
}

/** Default progression uses earned resources; the paid aircraft scenario declares its gold credit. */
function spendEarned(profile: Profile, level: number, seconds: number, timeline: ProgressEvent[], options: PlaythroughOptions) {
  const event = (kind: string, detail: string) => {
    const row = {kind, level, seconds, model: profile.selected, silver: profile.silver, xp: profile.xp, detail};
    timeline.push(row); options.onEvent?.(row);
  };
  const silverPlanes = PLANES.filter(p => p.currency === 'silver' && planeUnlocked(profile, p));
  const target = silverPlanes.at(-1)!;
  if (profile.selected !== 'skate' && !profile.owned.includes(target.id) && profile.silver >= target.price) { buyPlane(profile, target.id); event('aircraft', target.name); }
  const phoenix = PLANES.find(model => model.id === 'skate')!;
  if (options.paidPhoenix && !profile.owned.includes(phoenix.id) && planeUnlocked(profile, phoenix)) { buyPlane(profile, phoenix.id); event('paid-aircraft', phoenix.name); }
  if (options.upgradePolicy === 'none') return;
  const current = PLANES.find(p => p.id === profile.selected)!;
  const nextPlane = PLANES.find(p => p.currency === 'silver' && p.hp > current.hp && !profile.owned.includes(p.id));
  const unlockedWaiting = nextPlane && planeUnlocked(profile, nextPlane);
  // Upgrade modestly before unlocking the next aircraft, then reserve its purchase price.
  const plan: Upgrade[] = ['gun', 'hull', 'gun', 'engine', 'hull', 'gun', 'engine', 'hull', 'gun', 'engine', 'hull', 'gun', 'engine', 'hull', 'engine'];
  const ceiling = nextPlane ? 2 : 5;
  for (const branch of plan) {
    const n = (profile.upgrades[profile.selected]?.[branch] ?? 0) + 1;
    if (n > ceiling || n > 5 || (unlockedWaiting && profile.silver - upgradeSilver(n) < nextPlane!.price)) continue;
    if (profile.silver < upgradeSilver(n) || profile.xp < RESEARCH_XP[n - 1]) continue;
    researchUpgrade(profile, branch, n); buyUpgrade(profile, branch, n); event('upgrade', branch + ' ' + n);
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
  const paidGoldCredit = options.paidPhoenix ? PLANES.find(model => model.id === 'skate')!.price : 0;
  profile.gold += paidGoldCredit;
  const result: PlaythroughResult = {seed: options.seed, completed: false, reachedLevel: 1, stoppedReason: '', finalPhase: 'flight', activeSeconds: 0, flightSeconds: 0, bossSeconds: 0, deaths: 0, bossDeaths: 0, rollbacks: 0, bossVictories: [], earned: {silver: 0, xp: 0}, finalProfile: profile, timeline: [], visits: [], scenario: {modifierChoice: options.modifierChoice ?? 'priority', upgradePolicy: options.upgradePolicy ?? 'balanced', paidGoldCredit, controls: {...options.controls}}};
  const controller = sampledPilot(options.controls);
  const event = (kind: string, level: number, detail: string) => {
    const row = {kind, level, seconds: result.activeSeconds, model: profile.selected, silver: profile.silver, xp: profile.xp, detail};
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
  while (result.activeSeconds < (options.maxActiveSeconds ?? 12 * 3600)) {
    result.reachedLevel = Math.max(result.reachedLevel, battle.level);
    if (battle.phase === 'boss-intro') {
      if (visitPhase === 'flight') finishVisit('passed');
      spendEarned(profile, battle.level, result.activeSeconds, result.timeline, options);
      refreshPlaneStats(battle.planes[0], planeStats(profile, true));
      prepareBossAttempt(account, battle); startBossFight(battle);
      visitLevel = battle.level; visitPhase = 'boss'; visitStart = result.activeSeconds;
      visitModifiers = structuredClone(profile.modifiers ?? []);
      event('boss-start', battle.level, 'attempt ' + battle.bossAttempt);
    }
    const previousLevel = battle.level, previousPhase = battle.phase, beforeShot = battle.planes[0].shot, beforeRocketClock = battle.planes[0].rocketClock ?? 10;
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
    if (battle.phase === 'reward') {
      finishVisit('passed'); event('boss-win', previousLevel, 'HP ' + Math.round(battle.planes[0].health));
      refreshPlaneStats(battle.planes[0], planeStats(profile, true)); finishBossReward(battle);
      if (previousLevel >= endLevel) { result.completed = true; result.stoppedReason = 'final boss defeated'; break; }
      spendEarned(profile, battle.level, result.activeSeconds, result.timeline, options);
      refreshPlaneStats(battle.planes[0], planeStats(profile, true));
      visitLevel = battle.level; visitPhase = 'flight'; visitStart = result.activeSeconds;
      visitModifiers = structuredClone(profile.modifiers ?? []);
    } else if (battle.phase === 'ended' && battle.planes[0].health <= 0) {
      finishVisit('lost'); result.deaths++; if (previousPhase === 'boss') result.bossDeaths++;
      finishCareer(account, battle); if (battle.bossAttemptsExhausted) result.rollbacks++;
      event('death', previousLevel, (battle.bossAttemptsExhausted ? 'rollback to ' + account.restartLevel : 'retry') + ', phase ' + previousPhase);
      if (result.deaths >= (options.maxDeaths ?? 200)) { result.stoppedReason = 'death limit'; break; }
      spendEarned(profile, account.restartLevel ?? previousLevel, result.activeSeconds, result.timeline, options);
      battle = createBattle('campaign-seed-' + options.seed + '-sortie-' + ++sortie, 'pve', [makePlane(profile.id, planeStats(profile, true))], account.restartLevel ?? previousLevel);
      if (account.restartBoss) { approachBoss(battle); prepareBossAttempt(account, battle); }
      visitLevel = battle.level; visitPhase = account.restartBoss ? 'boss' : 'flight'; visitStart = result.activeSeconds;
      visitModifiers = structuredClone(profile.modifiers ?? []);
    } else if (battle.level !== previousLevel) {
      finishVisit('passed'); event('level', previousLevel, 'passed');
      if (previousLevel >= endLevel) { result.completed = true; result.stoppedReason = 'requested level passed'; break; }
      visitLevel = battle.level; visitPhase = 'flight'; visitStart = result.activeSeconds;
    }
  }
  if (!result.stoppedReason) result.stoppedReason = 'active time limit';
  result.finalPhase = battle.phase;
  return result;
}

export function estimateHumanTime(runs: PlaythroughResult[]) {
  const complete = runs.filter(r => r.completed);
  if (!complete.length) return undefined;
  const mean = (f: (r: PlaythroughResult) => number) => complete.reduce((n, r) => n + f(r), 0) / complete.length;
  const active = mean(r => r.activeSeconds), flights = mean(r => r.flightSeconds), bosses = mean(r => r.bossSeconds);
  const decisions = mean(r => r.bossVictories.length) * 35 + mean(r => r.timeline.filter(e => ['upgrade', 'aircraft', 'paid-aircraft'].includes(e.kind)).length) * 15;
  const tutorials = 120;
  const skillScenarioBossSeconds = mean(r => r.visits.filter(v => v.phase === 'boss' && v.outcome === 'passed').reduce((n, v) => n + (v.firingReference?.fortyPercentHitRateSeconds ?? v.seconds), 0));
  // Scenarios, not measured human participants. Boss aiming is slower; flights have fixed pacing.
  return {basis: 'Scenario estimate; no human participants were timed. Excludes real-life breaks. Autopilot knows visible positions precisely; input limits and purchase/card policies are declared per run rather than claimed to reproduce human skill.', automatedActiveSeconds: active, flightSeconds: flights, bossSeconds: bosses,
    modeledScenarios: complete.map(r => ({seed: r.seed, ...r.scenario})),
    excludedIncompleteRuns: runs.filter(r => !r.completed).map(r => ({seed: r.seed, reachedLevel: r.reachedLevel, reason: r.stoppedReason, activeSeconds: r.activeSeconds, deaths: r.deaths, scenario: r.scenario})),
    sustainedFortyPercentAimScenario: {bossSeconds: skillScenarioBossSeconds, menusSeconds: decisions, tutorialSeconds: tutorials, totalHours: (flights + skillScenarioBossSeconds + decisions + tutorials) / 3600, qualification: 'Optimistic weapon-throughput scenario with the same earned builds and flight deaths. Assumes sustained 40% useful bullet damage, not the measured cautious autopilot firing duty. No timed human data.'},
    experienced: {activeBossMultiplier: 1.25, extraRetriesSeconds: .05 * active, menusSeconds: decisions, tutorialSeconds: tutorials, totalHours: (flights + bosses * 1.25 + .05 * active + decisions + tutorials) / 3600},
    firstTime: {activeBossMultiplier: 1.8, extraRetriesSeconds: .35 * active, menusSeconds: decisions * 1.5, tutorialSeconds: tutorials, totalHours: (flights + bosses * 1.8 + .35 * active + decisions * 1.5 + tutorials) / 3600},
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seeds = (process.env.CAMPAIGN_SEEDS ?? '1,7,42').split(',').map(Number), endLevel = Number(process.env.CAMPAIGN_END ?? ZONE.length);
  const runs = seeds.map(seed => runCampaign({seed, endLevel, onEvent: e => {
    if (['boss-start', 'boss-win', 'death', 'aircraft'].includes(e.kind)) console.log('seed', seed, e.kind, e.level, Math.round(e.seconds) + 's', e.model, e.detail);
  }}));
  const report = {generatedAt: new Date().toISOString(),levels: endLevel, timestep: DT, method: 'Authoritative stepBattle at 30 Hz, only ordinary player controls. All level distance and boss HP completed through real movement and weapon hits. Economy starts with freshProfile: 200 silver / 0 XP / 0 gold; research and purchases use server helpers. Boss choices are drawn from actual earned offers. No debug commands, skipped fights, HP edits, immunity, premium, tasks, ads or login bonuses. Menus are instant in automation and included as explicit human-estimate assumptions.', metrics: 'shots counts launched primary/side/rocket projectiles. triggerPulls counts primary weapon discharges. landedProjectiles counts observed first impacts against the boss; a newly launched projectile removed in the same frame can be absent, so observedHitRate is a lower bound. hitFrames counts simulation frames with boss damage, which can contain several impacts. shotDutyFraction uses triggerPulls times 0.18s/visit duration. Firing references are isolated stationary weapon fixtures, never campaign victories.', runs, humanEstimate: estimateHumanTime(runs)};
  await mkdir('design-review', {recursive: true}); await writeFile('design-review/campaign-playthrough.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({runs: runs.map(({visits, timeline, finalProfile, ...summary}) => summary),humanEstimate: report.humanEstimate}, null, 2));
  if (runs.some(r => !r.completed)) process.exitCode = 1;
}
