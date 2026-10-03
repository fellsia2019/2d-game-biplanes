import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_LEVELS, CURRENT_PROGRESSION_VERSION, MAX_UPGRADE_LEVEL, MODEL_COST_FACTORS, PLANES, RESEARCH_XP, UPGRADE_SILVER, ZONE, bossBalance, bossReferenceAircraft, campaignAircraft, campaignReward, freshProfile, modelCostFactor, normalizeProgression, planeLockedReason, planeStats, planeUnlocked, planeUnlockRequirements, researchLevel, researchXp, upgradeLevel, upgradeSilver, type Profile, type Upgrade } from '../shared/data';
import { buyPlane, buyUpgrade, researchUpgrade } from '../server/economy';
import { campaignMinimumSeconds, operationPlan } from '../shared/operations';

const branches: readonly Upgrade[] = ['hull', 'engine', 'gun'];
const snapshot = (p: Profile) => JSON.stringify(p);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function funded(model: string) {
  // Isolated, funded progression fixture. Earned campaign time is measured by
  // the separate ordinary-controls playthrough, not by these injected balances.
  const p = freshProfile('v08-' + model); p.selected = model; p.owned = PLANES.map(plane => plane.id);
  p.silver = 1000000; p.xp = p.totalXp = 1000000; p.gold = 900;
  return p;
}
function fullyUpgrade(p: Profile, model: string) {
  p.selected = model;
  for (const branch of branches) for (let level = 1; level <= MAX_UPGRADE_LEVEL; level++) {
    researchUpgrade(p, branch, level); buyUpgrade(p, branch, level);
  }
}

test('15 small steps preserve total first-aircraft cost and the old maximum physical bonuses', () => {
  assert.equal(MAX_UPGRADE_LEVEL, 15); assert.equal(CURRENT_PROGRESSION_VERSION, 2);
  assert.equal(RESEARCH_XP.length, 15); assert.equal(UPGRADE_SILVER.length, 15);
  assert.equal(RESEARCH_XP.reduce((n, value) => n + value, 0), 800);
  assert.equal(UPGRADE_SILVER.reduce((n, value) => n + value, 0), 2540);
  assert.ok(Math.max(...RESEARCH_XP) <= 80); assert.ok(Math.max(...UPGRADE_SILVER) <= 250);
  assert.ok(RESEARCH_XP[0] <= 20 && UPGRADE_SILVER[0] <= 200);
  for (let i = 1; i < MAX_UPGRADE_LEVEL; i++) {
    assert.ok(RESEARCH_XP[i] >= RESEARCH_XP[i - 1]); assert.ok(UPGRADE_SILVER[i] >= UPGRADE_SILVER[i - 1]);
  }
  assert.deepEqual(MODEL_COST_FACTORS, {universal: 1, swift: 18, yantar: 50, bastion: 38});
  for (const model of PLANES.filter(model => model.currency === 'silver')) {
    const p = funded(model.id), initial = planeStats(p); fullyUpgrade(p, model.id); const full = planeStats(p);
    close(full.hp, initial.hp * 1.3); close(full.damage, initial.damage * 1.3);
    close(full.speed, initial.speed * 1.1); close(full.turn, initial.turn * 1.05);
    assert.equal(p.xp, 1000000 - 2400 * modelCostFactor(model.id));
    assert.equal(p.silver, 1000000 - 7620 * modelCostFactor(model.id)); assert.equal(p.gold, 900);
  }
});

for (const model of PLANES.filter(model => model.currency === 'silver')) test(model.name + ': each of 45 legal upgrade steps charges its model price and changes only its branch', () => {
  for (const branch of branches) {
    const p = funded(model.id), base = planeStats(p);
    for (let level = 1; level <= MAX_UPGRADE_LEVEL; level++) {
      let before = snapshot(p); assert.throws(() => buyUpgrade(p, branch, level), /исследуйте/); assert.equal(snapshot(p), before);
      const xp = p.xp, silver = p.silver, priorStats = planeStats(p);
      researchUpgrade(p, branch, level); assert.equal(p.xp, xp - researchXp(level, model.id)); assert.deepEqual(planeStats(p), priorStats);
      before = snapshot(p); researchUpgrade(p, branch, level); assert.equal(snapshot(p), before);
      const poor = structuredClone(p); poor.silver = upgradeSilver(level, model.id) - 1; before = snapshot(poor);
      assert.throws(() => buyUpgrade(poor, branch, level), /серебра/); assert.equal(snapshot(poor), before);
      buyUpgrade(p, branch, level); assert.equal(p.silver, silver - upgradeSilver(level, model.id));
      const stats = planeStats(p); close(stats.hp, base.hp * (branch === 'hull' ? 1 + level * .02 : 1));
      close(stats.damage, base.damage * (branch === 'gun' ? 1 + level * .02 : 1));
      close(stats.speed, base.speed * (branch === 'engine' ? 1 + level * .10 / 15 : 1));
      close(stats.turn, base.turn * (branch === 'engine' ? 1 + level * .05 / 15 : 1));
      assert.equal(upgradeLevel(p, model.id, branch), level); assert.equal(p.totalXp, 1000000);
    }
    const before = snapshot(p); assert.throws(() => researchUpgrade(p, branch, 16)); assert.throws(() => buyUpgrade(p, branch, 16)); assert.equal(snapshot(p), before);
  }
});

test('Invalid cost levels and models cannot turn a purchase into zero, negative or NaN cost', () => {
  for (const level of [-1, 0, 1.2, 16, NaN, Infinity]) {
    assert.equal(upgradeSilver(level), Infinity); assert.equal(researchXp(level), Infinity);
  }
  for (const model of ['missing', '__proto__', 'constructor']) { assert.equal(upgradeSilver(1, model), Infinity); assert.equal(researchXp(1, model), Infinity); }
  const p = funded('swift'); p.xp = researchXp(1, 'swift') - 1;
  const before = snapshot(p); assert.throws(() => researchUpgrade(p, 'gun', 1), /опыта/); assert.equal(snapshot(p), before);
});

test('Next free aircraft needs its boss and all 45 predecessor upgrades; money and research cannot bypass the gate', () => {
  for (const [previous, next, boss] of [['universal', 'swift', 25], ['swift', 'yantar', 100], ['yantar', 'bastion', 200]] as const) {
    const p = freshProfile('gate-' + next); p.silver = p.xp = 1000000; p.totalXp = p.xp; if (!p.owned.includes(previous)) p.owned.push(previous);
    const model = PLANES.find(model => model.id === next)!;
    assert.equal(model.unlockBoss, boss); assert.equal(planeUnlocked(p, model), false);
    assert.match(planeLockedReason(p, model), /босса/);
    p.defeatedBosses = [boss]; assert.equal(planeUnlocked(p, model), false);
    const request = planeUnlockRequirements(p, model); assert.equal(request.previousPlane!.id, previous); assert.equal(request.missingUpgrades.length, 3);
    let before = snapshot(p); assert.throws(() => buyPlane(p, next), /Полностью/); assert.equal(snapshot(p), before);
    p.research![previous] = {hull: 15, engine: 15, gun: 15}; p.upgrades[previous] = {hull: 15, engine: 15, gun: 14};
    assert.equal(planeUnlocked(p, model), false); assert.deepEqual(planeUnlockRequirements(p, model).missingUpgrades, [{branch: 'gun', current: 14, required: 15}]);
    p.selected = previous; buyUpgrade(p, 'gun', 15); assert.equal(planeUnlocked(p, model), true); assert.equal(planeLockedReason(p, model), '');
    const silver = p.silver; buyPlane(p, next); assert.equal(p.silver, silver - model.price); assert.equal(p.selected, next);
    before = snapshot(p); buyPlane(p, next); assert.equal(snapshot(p), before);
  }
});

test('Phoenix is available from the start for gold; already purchased aircraft keep access despite the free-plane gates', () => {
  const p = freshProfile('phoenix'); p.gold = 300;
  assert.equal(planeUnlocked(p, PLANES[4]), true); buyPlane(p, 'skate'); assert.equal(p.gold, 0); assert.ok(p.owned.includes('skate'));
  p.defeatedBosses = []; p.upgrades = {};
  assert.equal(planeUnlocked(p, PLANES[4]), true); assert.equal(planeLockedReason(p, PLANES[4]), '');
  for (const model of PLANES) { p.owned.push(model.id); assert.equal(planeUnlocked(p, model), true); }
});

test('Legacy paid levels and research migrate ×3 once while read helpers preserve aircraft stats before migration', () => {
  const p = funded('universal'); delete p.progressionVersion; p.modifiers = [{id: 'reinforced-hull', level: 2}]; p.skills = {phase: true};
  for (const model of PLANES) {
    p.upgrades[model.id] = {hull: 1, engine: 3, gun: 5}; p.research![model.id] = {hull: 2, engine: 4, gun: 5};
  }
  const before = snapshot(p), stats = PLANES.map(model => planeStats({...p, selected: model.id}, true));
  for (const model of PLANES) {
    if (model.id === 'skate') continue;
    const value = planeStats({...p, selected: model.id}); close(value.hp, model.hp * 1.06); close(value.damage, model.damage * 1.3);
    close(value.speed, model.speed * 1.06); close(value.turn, model.turn * 1.03);
    assert.equal(researchLevel(p, model.id, 'hull'), 6); assert.equal(upgradeLevel(p, model.id, 'engine'), 9);
  }
  assert.equal(snapshot(p), before, 'Read helpers never mutate old profiles');
  const balances = {silver: p.silver, gold: p.gold, xp: p.xp}; normalizeProgression(p);
  assert.equal(p.progressionVersion, 2); assert.deepEqual({silver: p.silver, gold: p.gold, xp: p.xp}, balances);
  assert.deepEqual(p.upgrades.universal, {hull: 3, engine: 9, gun: 15}); assert.deepEqual(p.research!.universal, {hull: 6, engine: 12, gun: 15});
  assert.deepEqual(PLANES.map(model => planeStats({...p, selected: model.id}, true)), stats);
  const migrated = snapshot(p); normalizeProgression(p); assert.equal(snapshot(p), migrated);
  assert.deepEqual(p.modifiers, [{id: 'reinforced-hull', level: 2}]); assert.deepEqual(p.skills, {phase: true});
});

test('A legacy researched next step can be purchased after conversion and an invalid old request cannot mutate the profile', () => {
  const p = funded('swift'); delete p.progressionVersion; p.upgrades.swift = {hull: 2, engine: 0, gun: 0}; p.research!.swift = {hull: 3, engine: 0, gun: 0};
  const before = snapshot(p); assert.throws(() => buyUpgrade(p, 'hull', 3)); assert.equal(snapshot(p), before);
  const silver = p.silver; buyUpgrade(p, 'hull', 7);
  assert.equal(p.progressionVersion, 2); assert.equal(p.upgrades.swift.hull, 7); assert.equal(p.research!.swift.hull, 9);
  assert.equal(p.silver, silver - upgradeSilver(7, 'swift'));
});

test('Legacy full predecessor upgrades satisfy unlock reads before migration without losing owned planes', () => {
  const p = freshProfile('legacy-gate'); delete p.progressionVersion; p.upgrades.universal = {hull: 5, engine: 5, gun: 5}; p.defeatedBosses = [25];
  const before = snapshot(p); assert.equal(planeUnlocked(p, PLANES[1]), true); assert.equal(snapshot(p), before);
  p.owned.push('bastion'); assert.equal(planeUnlocked(p, PLANES[3]), true);
});

test('Model tiers and missions enforce more than 30 active hours before Ruby while keeping individual sorties at 90s', () => {
  assert.equal(campaignAircraft(25).id, 'universal'); assert.equal(campaignAircraft(26).id, 'swift');
  assert.equal(campaignAircraft(100).id, 'swift'); assert.equal(campaignAircraft(101).id, 'yantar');
  assert.equal(campaignAircraft(200).id, 'yantar'); assert.equal(campaignAircraft(201).id, 'bastion');
  assert.ok(campaignMinimumSeconds(200) / 3600 > 33); assert.ok(campaignMinimumSeconds(250) / 3600 > 43);
  for (const def of ZONE) {
    close(def.length / def.scroll, operationPlan(def.level).seconds); assert.ok(def.length / def.scroll <= 90 + 1e-8);
    assert.equal(campaignReward(def.rewardSilver), 90); assert.equal(campaignReward(def.rewardXp), 40);
    const model = campaignAircraft(def.level), p = funded(model.id); p.upgrades[model.id] = {hull: 15, engine: 15, gun: 15};
    const stats = planeStats(p); assert.ok(Math.ceil(def.enemyHp / stats.damage) <= 6); assert.ok(Math.ceil(stats.hp / def.enemyDamage) >= 12);
  }
  assert.deepEqual(BOSS_LEVELS, [10, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250]);
  for (const level of BOSS_LEVELS) {
    const boss = bossBalance(level), model = bossReferenceAircraft(level);
    assert.ok(boss.windup >= .45 && boss.cooldown >= 1.35); assert.ok(boss.speed < model.speed * .6);
    assert.ok(boss.hp <= 13000); assert.ok(boss.damage < model.hp / 10);
  }
});

test('Profile phase skill follows the pilot across all planes and only affects campaign stats', () => {
  const p = funded('universal'); assert.equal(planeStats(p, true).phaseSkill, false); p.skills = {phase: true};
  for (const model of PLANES) { p.selected = model.id; assert.equal(planeStats(p, true).phaseSkill, true); assert.equal(planeStats(p).phaseSkill, false); }
});
