import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPGRADE_LEVEL, MODULES, PLANES, freshProfile, normalizeProgression, planeStats, researchLevel, researchXp, upgradeSilver, type Profile, type Upgrade } from '../shared/data';
import { buyModule, buyPlane, buyUpgrade, equipModule, researchUpgrade } from '../server/economy';
import { modifierBonuses } from '../shared/modifiers';
import { createBattle, makePlane, refreshPlaneStats, stepBattle } from '../shared/simulation';

const branches: Upgrade[] = ['hull', 'engine', 'gun'];
const snapshot = (profile: Profile) => JSON.stringify(profile);
function equipped(model: typeof PLANES[number]['id']) {
  const profile = freshProfile('audit-' + model);
  profile.defeatedBosses = [25, 100, 200]; profile.silver = 10000000; profile.gold = 1000; profile.xp = profile.totalXp = 10000000;
  // Ownership is a fixture here; actual purchase gates are exercised below.
  profile.owned = PLANES.map(plane => plane.id); profile.selected = model;
  return profile;
}
function predecessorMaxed(profile: Profile, model: string) {
  const previous = ({ swift: 'universal', yantar: 'swift', bastion: 'yantar' } as Record<string, string>)[model];
  if (!previous) return;
  if (!profile.owned.includes(previous)) profile.owned.push(previous);
  profile.upgrades[previous] = { hull: MAX_UPGRADE_LEVEL, engine: MAX_UPGRADE_LEVEL, gun: MAX_UPGRADE_LEVEL };
  profile.research![previous] = { ...profile.upgrades[previous] };
}
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); }

test('Каждый покупаемый самолёт проверяет своего босса и свою валюту до списания, повторная покупка бесплатна', () => {
  for (const model of PLANES) {
    const profile = freshProfile('aircraft-' + model.id); profile.gold = 1000; profile.silver = 50000;
    if (model.unlockBoss) {
      const before = snapshot(profile); assert.throws(() => buyPlane(profile, model.id), /босса/); assert.equal(snapshot(profile), before);
      profile.defeatedBosses = [model.unlockBoss]; predecessorMaxed(profile, model.id); profile[model.currency] = model.price - 1;
      const poor = snapshot(profile); assert.throws(() => buyPlane(profile, model.id), /Недостаточно/); assert.equal(snapshot(profile), poor);
      profile[model.currency] = model.price;
    }
    const balance = profile[model.currency], otherCurrency = model.currency === 'gold' ? 'silver' : 'gold', otherBalance = profile[otherCurrency];
    buyPlane(profile, model.id); assert.equal(profile[model.currency], balance - model.price); assert.equal(profile[otherCurrency], otherBalance);
    assert.ok(profile.owned.includes(model.id)); assert.equal(profile.selected, model.id);
    const before = snapshot(profile); buyPlane(profile, model.id); assert.equal(snapshot(profile), before);
  }
});

for (const model of PLANES.filter(model => model.currency === 'silver')) test(model.name + ': 15 уровней каждой ветки исследуются и покупаются отдельно без изменения остальных моделей', () => {
  for (const branch of branches) {
    const profile = equipped(model.id), base = planeStats(profile), gold = profile.gold;
    const otherModels = PLANES.filter(other => other.id !== model.id).map(other => planeStats({ ...profile, selected: other.id }));
    for (let level = 1; level <= MAX_UPGRADE_LEVEL; level++) {
      let before = snapshot(profile);
      assert.throws(() => buyUpgrade(profile, branch, level), /исследуйте/); assert.equal(snapshot(profile), before);
      const lowXp = structuredClone(profile); lowXp.xp = researchXp(level, model.id) - 1;
      before = snapshot(lowXp); assert.throws(() => researchUpgrade(lowXp, branch, level), /опыта/); assert.equal(snapshot(lowXp), before);
      const stats = planeStats(profile), xp = profile.xp, silver = profile.silver;
      researchUpgrade(profile, branch, level);
      assert.equal(profile.xp, xp - researchXp(level, model.id)); assert.equal(profile.silver, silver); assert.equal(profile.gold, gold);
      assert.equal(researchLevel(profile, model.id, branch), level); assert.deepEqual(planeStats(profile), stats);
      before = snapshot(profile); researchUpgrade(profile, branch, level); assert.equal(snapshot(profile), before, 'Повтор исследования не списываетXP');
      const lowSilver = structuredClone(profile); lowSilver.silver = upgradeSilver(level, model.id) - 1;
      before = snapshot(lowSilver); assert.throws(() => buyUpgrade(lowSilver, branch, level), /серебра/); assert.equal(snapshot(lowSilver), before);
      buyUpgrade(profile, branch, level); assert.equal(profile.silver, silver - upgradeSilver(level, model.id)); assert.equal(profile.gold, gold);
      const result = planeStats(profile);
      close(result.hp, base.hp * (branch === 'hull' ? 1 + level / MAX_UPGRADE_LEVEL * .3 : 1));
      close(result.damage, base.damage * (branch === 'gun' ? 1 + level / MAX_UPGRADE_LEVEL * .3 : 1));
      close(result.speed, base.speed * (branch === 'engine' ? 1 + level / MAX_UPGRADE_LEVEL * .1 : 1));
      close(result.turn, base.turn * (branch === 'engine' ? 1 + level / MAX_UPGRADE_LEVEL * .05 : 1));
      assert.equal(profile.upgrades[model.id][branch], level);
      for (const other of branches.filter(item => item !== branch)) assert.equal(profile.upgrades[model.id][other], 0);
      before = snapshot(profile); assert.throws(() => buyUpgrade(profile, branch, level)); assert.equal(snapshot(profile), before);
      assert.deepEqual(PLANES.filter(other => other.id !== model.id).map(other => planeStats({ ...profile, selected: other.id })), otherModels);
      assert.equal(profile.totalXp, 10000000, 'Потраченный XP не понижает ранг пилота');
    }
    const before = snapshot(profile);
    for (const invalid of [0, MAX_UPGRADE_LEVEL + 1, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => researchUpgrade(profile, branch, invalid)); assert.throws(() => buyUpgrade(profile, branch, invalid));
      assert.equal(snapshot(profile), before);
    }
  }
});

test('Исследование конкретной модели сохраняется при переключениях и не даёт бесплатное улучшение другой', () => {
  const profile = equipped('universal');
  for (const model of PLANES.filter(model => model.currency === 'silver')) {
    profile.selected = model.id;
    for (const branch of branches) researchUpgrade(profile, branch, 1);
  }
  const xp = profile.xp;
  for (const model of PLANES.filter(model => model.currency === 'silver').reverse()) {
    profile.selected = model.id;
    for (const branch of branches) { researchUpgrade(profile, branch, 1); buyUpgrade(profile, branch, 1); }
    assert.deepEqual(profile.upgrades[model.id], {hull: 1, engine: 1, gun: 1});
  }
  assert.equal(profile.xp, xp);
  const restricted = equipped('universal'); researchUpgrade(restricted, 'gun', 1);
  restricted.selected = 'swift'; const before = snapshot(restricted);
  assert.throws(() => buyUpgrade(restricted, 'gun', 1), /исследуйте/); assert.equal(snapshot(restricted), before);
});

for (const model of PLANES) test(model.name + ': золотые модули имеют один слот, сохраняются при переключении и не оплачиваются повторно', () => {
  const profile = equipped(model.id), base = planeStats(profile);
  for (const item of MODULES) {
    const lowGold = structuredClone(profile); lowGold.gold = item.price - 1;
    const before = snapshot(lowGold); assert.throws(() => buyModule(lowGold, item.id), /золота/); assert.equal(snapshot(lowGold), before);
    const gold = profile.gold; buyModule(profile, item.id); assert.equal(profile.gold, gold - item.price);
    const owned = snapshot(profile); buyModule(profile, item.id); assert.equal(snapshot(profile), owned);
  }
  equipModule(profile, 'carburetor'); const carb = planeStats(profile);
  assert.equal(carb.boostDuration, 3); assert.equal(carb.boostRecharge, 6); assert.equal(carb.cooling, 1); assert.equal(carb.damage, base.damage);
  equipModule(profile, 'radiator'); const radiator = planeStats(profile);
  assert.equal(radiator.boostDuration, 2); assert.equal(radiator.boostRecharge, 6); assert.equal(radiator.cooling, 1.35); close(radiator.damage, base.damage);
  for (const key of ['hp', 'speed', 'turn'] as const) { assert.equal(carb[key], base[key]); assert.equal(radiator[key], base[key]); }
  const before = snapshot(profile); assert.throws(() => equipModule(profile, 'missing')); assert.equal(snapshot(profile), before);
  equipModule(profile, ''); assert.deepEqual(planeStats(profile), base);
  const saved = JSON.parse(snapshot(profile)); equipModule(saved, 'radiator'); assert.deepEqual(planeStats(saved), radiator);
});

test('Старые оплаченные уровни всех моделей восстанавливают исследования, оставляя характеристики и кошелёк', () => {
  const profile = equipped('universal');
  profile.owned = PLANES.map(model => model.id);
  for (const model of PLANES) profile.upgrades[model.id] = {hull: 5, engine: 3, gun: 4};
  delete profile.research; delete profile.totalXp; delete profile.progressionVersion;
  const balances = {silver: profile.silver, gold: profile.gold, xp: profile.xp};
  const stats = PLANES.map(model => planeStats({...profile, selected: model.id}));
  normalizeProgression(profile);
  assert.deepEqual({silver: profile.silver, gold: profile.gold, xp: profile.xp}, balances);
  for (const [index, model] of PLANES.entries()) {
    assert.deepEqual(profile.upgrades[model.id], { hull: 15, engine: 9, gun: 12 });
    assert.deepEqual(profile.research![model.id], profile.upgrades[model.id]);
    assert.deepEqual(planeStats({...profile, selected: model.id}), stats[index]);
  }
  const before = snapshot(profile); normalizeProgression(profile); assert.equal(snapshot(profile), before);
});

test('Постоянные бонусы переходят между всеми самолётами; смена самолёта в сохранённом бою сохраняет долю здоровья', () => {
  const profile = equipped('universal');
  profile.modifiers = [{id: 'reinforced-hull', level: 1}, {id: 'heavy-caliber', level: 1}, {id: 'fuel-reserve', level: 1}];
  const traits = modifierBonuses(profile.modifiers), plane = makePlane(profile.id, planeStats(profile, true)); plane.health = plane.hp * .25;
  const battle = createBattle('saved-aircraft-switch', 'pve', [plane]); plane.health = plane.hp * .25;
  for (const model of PLANES) {
    profile.selected = model.id;
    const base = planeStats(profile), campaign = planeStats(profile, true);
    close(campaign.hp, base.hp * 1.2); close(campaign.damage, base.damage * 1.2); close(campaign.boostDuration, base.boostDuration * 1.3);
    assert.deepEqual(campaign.traits, traits); assert.equal(base.traits, undefined);
    refreshPlaneStats(battle.planes[0], campaign); close(battle.planes[0].health / battle.planes[0].hp, .25);
  }
  plane.health = 0; refreshPlaneStats(plane, planeStats(profile, true)); assert.equal(plane.health, 0);
});

test('Горизонтальный Феникс охлаждается одинаково вправо и влево; разворот не выдаёт бонус пикирования', () => {
  function firing(angle: number, module: '' | 'radiator') {
    const profile = equipped('skate'); profile.phoenixParts = {hull: 6, engine: 6, gun: 6};
    if (module) buyModule(profile, module);
    const plane = makePlane(profile.id, planeStats(profile)), battle = createBattle('mirror-heat', 'duel', [plane]);
    plane.y = 100; plane.angle = angle;
    let shots = 0, overheatedFrames = 0;
    for (let frame = 0; frame < 1800; frame++) {
      const seq = battle.seq;
      stepBattle(battle, {[profile.id]: {turn: 0, fire: true, boost: false}}, 1 / 30);
      shots += battle.effects.filter(effect => effect.kind === 'shot' && effect.id > seq).length;
      if (plane.overheated) overheatedFrames++;
    }
    close(plane.y, 100); return {shots, overheatedFrames};
  }
  for (const module of ['', 'radiator'] as const) {
    const right = firing(0, module), left = firing(Math.PI, module);
    assert.deepEqual(left, right); assert.ok(right.overheatedFrames > 0);
  }
});

test('Удержанный форсаж всех пяти самолётов перезапускается после полной зарядки без импульсов по одному кадру', () => {
  for (const model of PLANES) for (const module of ['', 'carburetor'] as const) {
    const profile = equipped(model.id); if (module) buyModule(profile, module);
    const plane = makePlane(profile.id, planeStats(profile)), battle = createBattle('held-boost', 'duel', [plane]); plane.y = 100;
    let previousBoost = false, runFrames = 0, starts = 0;
    const completedRuns: number[] = [];
    for (let frame = 0; frame < 1800; frame++) {
      const beforeEnergy = plane.energy;
      stepBattle(battle, {[profile.id]: {turn: 0, fire: false, boost: true}}, 1 / 30);
      assert.ok(Number.isFinite(plane.energy) && plane.energy >= 0 && plane.energy <= 1);
      if (plane.boosting) {
        if (!previousBoost) { starts++; close(beforeEnergy, 1); }
        runFrames++;
      } else if (previousBoost) { completedRuns.push(runFrames); runFrames = 0; }
      previousBoost = !!plane.boosting;
    }
    assert.ok(starts >= 4 && starts <= 9, `${model.id}/${module}: ${starts} стартов за60с`);
    for (const frames of completedRuns) assert.ok(frames >= (plane.boostDuration ?? 2) * .9 * 30, 'Каждый завершённый форсаж содержит цельный разгон');
    close(plane.health, plane.hp); close(plane.y, 100);
  }
});
