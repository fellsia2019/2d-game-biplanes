import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANES, freshProfile, normalizeProgression, planeStats, planeUnlocked, researchXp, upgradeSilver, type Upgrade } from '../shared/data';
import { buyPhoenixPart, buyPlane, buyUpgrade, researchUpgrade } from '../server/economy';
import { PHOENIX_BASE, PHOENIX_PART_LEVELS, PHOENIX_PART_STAGES, phoenixParts, phoenixPartLevel, phoenixPartRequirements, phoenixPartStats } from '../shared/phoenix';

const branches: Upgrade[] = ['hull', 'engine', 'gun'];
const snapshot = (p: unknown) => JSON.stringify(p);
function phoenix() {
  const p = freshProfile('phoenix-parts'); p.gold = 300; buyPlane(p, 'skate'); p.gold = 10000; p.silver = 321; p.xp = p.totalXp = 123;
  return p;
}
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test('Phoenix is available immediately for 300 gold at stock Swift strength with no silver/XP upgrade path', () => {
  const p = freshProfile('phoenix-start'); assert.equal(PLANES[4].unlockBoss, 0); assert.ok(planeUnlocked(p, PLANES[4]));
  p.gold = 299; const poor = snapshot(p); assert.throws(() => buyPlane(p, 'skate'), /золота/); assert.equal(snapshot(p), poor);
  p.gold = 300; const silver = p.silver, xp = p.xp; buyPlane(p, 'skate'); assert.equal(p.gold, 0);
  assert.equal(p.silver, silver); assert.equal(p.xp, xp); assert.deepEqual(phoenixPartStats(p), PHOENIX_BASE);
  assert.deepEqual(phoenixParts(p), {hull: 0, engine: 0, gun: 0});
  for (const branch of branches) {
    p.xp = p.silver = 1000000; const before = snapshot(p);
    assert.throws(() => researchUpgrade(p, branch, 1), /деталями/); assert.throws(() => buyUpgrade(p, branch, 1), /деталями/);
    assert.equal(snapshot(p), before); assert.equal(researchXp(1, 'skate'), Infinity); assert.equal(upgradeSilver(1, 'skate'), Infinity);
  }
  const bought = snapshot(p); buyPlane(p, 'skate'); assert.equal(snapshot(p), bought);
});

for (const branch of branches) test(`Phoenix ${branch}: six sequential boss gates charge only gold and affect their own stats`, () => {
  const p = phoenix();
  for (const stage of PHOENIX_PART_STAGES) {
    const initial = planeStats(p), before = snapshot(p);
    const requirement = phoenixPartRequirements(p, branch); assert.equal(requirement.level, stage.level); assert.equal(requirement.bossLevel, stage.bossLevel);
    assert.equal(requirement.price, stage.price); assert.equal(requirement.canBuy, false);
    assert.throws(() => buyPhoenixPart(p, branch, stage.level), /босса/); assert.equal(snapshot(p), before);
    p.defeatedBosses!.push(stage.bossLevel);
    const poor = structuredClone(p); poor.gold = stage.price - 1; const poorBefore = snapshot(poor);
    assert.throws(() => buyPhoenixPart(poor, branch, stage.level), /золота/); assert.equal(snapshot(poor), poorBefore);
    const gold = p.gold; assert.ok(phoenixPartRequirements(p, branch).canBuy); buyPhoenixPart(p, branch, stage.level);
    assert.equal(p.gold, gold - stage.price); assert.equal(p.silver, 321); assert.equal(p.xp, 123); assert.equal(p.totalXp, 123);
    assert.equal(phoenixPartLevel(p, branch), stage.level); const stats = planeStats(p);
    close(stats.hp, branch === 'hull' ? stage.hp : initial.hp); close(stats.damage, branch === 'gun' ? stage.damage : initial.damage);
    close(stats.speed, branch === 'engine' ? stage.speed : initial.speed); close(stats.turn, branch === 'engine' ? stage.turn : initial.turn);
    const duplicate = snapshot(p); assert.throws(() => buyPhoenixPart(p, branch, stage.level), /изменился|полностью/); assert.equal(snapshot(p), duplicate);
  }
  assert.equal(phoenixPartRequirements(p, branch).maxed, true); assert.equal(phoenixPartRequirements(p, branch).canBuy, false);
  for (const invalid of [0, -1, 1.5, NaN, Infinity, PHOENIX_PART_LEVELS + 1]) {
    const before = snapshot(p); assert.throws(() => buyPhoenixPart(p, branch, invalid)); assert.equal(snapshot(p), before);
  }
});

test('All 343 independent Phoenix part configurations stay within stage envelopes and survive saving/switching', () => {
  const p = phoenix();
  for (let hull = 0; hull <= 6; hull++) for (let engine = 0; engine <= 6; engine++) for (let gun = 0; gun <= 6; gun++) {
    p.phoenixParts = {hull, engine, gun};
    const stats = planeStats(p), h = PHOENIX_PART_STAGES[hull - 1] ?? PHOENIX_BASE, e = PHOENIX_PART_STAGES[engine - 1] ?? PHOENIX_BASE, g = PHOENIX_PART_STAGES[gun - 1] ?? PHOENIX_BASE;
    close(stats.hp, h.hp); close(stats.speed, e.speed); close(stats.turn, e.turn); close(stats.damage, g.damage);
    const saved = JSON.parse(snapshot(p)); saved.selected = 'universal'; assert.equal(planeStats(saved).hp, 100);
    saved.selected = 'skate'; assert.deepEqual(planeStats(saved), stats);
  }
  p.phoenixParts = {hull: 6, engine: 6, gun: 6}; assert.deepEqual(phoenixPartStats(p), {hp: 800, speed: 310, turn: 5, damage: 86});
  close(PHOENIX_PART_STAGES.reduce((total, stage) => total + stage.price, 0) * 3 + 300, 1665);
});

test('Invalid branches, unowned aircraft and out-of-order requests cannot mutate balances or buy free parts', () => {
  const unowned = freshProfile('no-phoenix'); unowned.gold = 10000; unowned.defeatedBosses = [25, 50, 100, 150, 200, 225];
  let before = snapshot(unowned); assert.throws(() => buyPhoenixPart(unowned, 'hull', 1), /купите/); assert.equal(snapshot(unowned), before);
  const p = phoenix(); p.defeatedBosses = [...unowned.defeatedBosses];
  for (const branch of ['missing', '__proto__', 'constructor']) { before = snapshot(p); assert.throws(() => buyPhoenixPart(p, branch as Upgrade, 1), /Неизвестная/); assert.equal(snapshot(p), before); }
  before = snapshot(p); assert.throws(() => buyPhoenixPart(p, 'gun', 2), /изменился/); assert.equal(snapshot(p), before);
  for (const level of [undefined, null, '1']) {
    before = snapshot(p); assert.throws(() => buyPhoenixPart(p, 'gun', level as unknown as number), /изменился/); assert.equal(snapshot(p), before);
  }
  p.gold = NaN; before = snapshot(p); assert.throws(() => buyPhoenixPart(p, 'gun', 1), /золота/); assert.equal(snapshot(p), before);
});

test('Both old 5-step and 15-step Phoenix saves migrate once without weakening paid stats or duplicating currency', () => {
  for (const progressionVersion of [undefined, 2]) for (const levels of [{hull: 0, engine: 0, gun: 0}, {hull: 1, engine: 3, gun: 5}, {hull: 5, engine: 5, gun: 5}]) {
    const p = phoenix(); delete p.phoenixVersion; delete p.phoenixParts; p.progressionVersion = progressionVersion;
    const scale = progressionVersion === 2 ? 3 : 1; p.upgrades.skate = {hull: levels.hull * scale, engine: levels.engine * scale, gun: levels.gun * scale};
    p.research!.skate = {hull: 15, engine: 15, gun: 15};
    const beforeRead = snapshot(p), beforeStats = planeStats(p); assert.equal(snapshot(p), beforeRead, 'Read helpers remain pure');
    const old = {hp: 935 * (1 + levels.hull * .06), damage: 102 * (1 + levels.gun * .06), speed: 300 * (1 + levels.engine * .02), turn: 5.2 * (1 + levels.engine * .01)};
    for (const key of ['hp', 'damage', 'speed', 'turn'] as const) assert.ok(beforeStats[key] >= old[key] - 1e-8);
    const balances = {gold: p.gold, silver: p.silver, xp: p.xp}; normalizeProgression(p);
    assert.deepEqual(planeStats(p), beforeStats); assert.deepEqual(phoenixParts(p), {hull: 6, engine: 6, gun: 6}); assert.equal(p.phoenixVersion, 1);
    assert.deepEqual({gold: p.gold, silver: p.silver, xp: p.xp}, balances);
    const migrated = snapshot(p); normalizeProgression(p); assert.equal(snapshot(p), migrated);
    assert.throws(() => buyPhoenixPart(p, 'gun', 1), /полностью/); assert.equal(snapshot(p), migrated);
  }
});

test('Buying Phoenix in an old save cannot grandfather an aircraft that was never purchased', () => {
  const p = freshProfile('old-unowned'); delete p.phoenixVersion; delete p.phoenixParts;
  p.upgrades.skate = {hull: 15, engine: 15, gun: 15}; p.gold = 300;
  buyPlane(p, 'skate'); assert.deepEqual(phoenixParts(p), {hull: 0, engine: 0, gun: 0}); assert.deepEqual(phoenixPartStats(p), PHOENIX_BASE);
  assert.equal(p.phoenixLegacyStats, undefined); normalizeProgression(p); assert.deepEqual(phoenixPartStats(p), PHOENIX_BASE);
});
