import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, PLANES, freshProfile, normalizeProgression, planeStats, ownedModules, equippedModule } from '../shared/data';
import { buyModule, buyPlane, equipModule } from '../server/economy';
const snapshot = (p: unknown) => JSON.stringify(p);

test('Gold equipment is purchased for each owned aircraft separately, saves its slot and has no stat penalty', () => {
  const p = freshProfile('equipment'); p.owned = PLANES.map(model => model.id); p.gold = 10000; const silver = p.silver, xp = p.xp;
  for (const plane of PLANES) {
    p.selected = plane.id; const base = planeStats(p), other = PLANES.filter(model => model.id !== plane.id).map(model => planeStats({...p, selected: model.id}));
    for (const module of MODULES) {
      const gold = p.gold; buyModule(p, module.id); assert.equal(p.gold, gold - module.price); assert.ok(ownedModules(p).includes(module.id));
      const bought = snapshot(p); buyModule(p, module.id); assert.equal(snapshot(p), bought);
    }
    equipModule(p, 'carburetor'); const carb = planeStats(p); assert.equal(carb.boostDuration, 3); assert.equal(carb.boostRecharge, 6);
    equipModule(p, 'radiator'); const radiator = planeStats(p); assert.equal(radiator.cooling, 1.35);
    for (const stats of [carb, radiator]) for (const key of ['hp', 'speed', 'turn', 'damage'] as const) assert.equal(stats[key], base[key]);
    assert.deepEqual(PLANES.filter(model => model.id !== plane.id).map(model => planeStats({...p, selected: model.id})), other);
    assert.equal(p.silver, silver); assert.equal(p.xp, xp);
  }
  assert.equal(p.gold, 10000 - 5 * 240);
  const saved = JSON.parse(snapshot(p));
  for (const plane of PLANES) { saved.selected = plane.id; assert.deepEqual(ownedModules(saved), ['carburetor', 'radiator']); assert.equal(equippedModule(saved), 'radiator'); }
});

test('A module on one plane cannot be equipped on another, and failed purchases mutate nothing', () => {
  const p = freshProfile('specific-plane'); p.owned.push('swift'); p.gold = 500; buyModule(p, 'radiator', 'universal');
  assert.deepEqual(ownedModules(p, 'swift'), []); assert.equal(equippedModule(p, 'swift'), '');
  assert.equal(p.planeEquipment!.swift, undefined); let before = snapshot(p);
  assert.throws(() => equipModule(p, 'radiator', 'swift'), /не куплен/); assert.equal(snapshot(p), before);
  for (const model of ['yantar', 'missing', '__proto__']) {
    before = snapshot(p); assert.throws(() => buyModule(p, 'carburetor', model), /Самолёт/); assert.throws(() => equipModule(p, '', model), /Самолёт/); assert.equal(snapshot(p), before);
  }
  p.gold = 119; before = snapshot(p); assert.throws(() => buyModule(p, 'carburetor', 'swift'), /золота/); assert.equal(snapshot(p), before);
  assert.throws(() => buyModule(p, 'missing'), /Неизвестный/); assert.equal(snapshot(p), before);
  for (const invalidGold of [NaN, Infinity]) {
    const invalid = structuredClone(p); invalid.gold = invalidGold; before = snapshot(invalid);
    assert.throws(() => buyModule(invalid, 'carburetor', 'swift'), /золота/); assert.equal(snapshot(invalid), before);
  }
  p.gold = 120; buyModule(p, 'carburetor', 'swift'); assert.equal(p.gold, 0); assert.equal(equippedModule(p, 'universal'), 'radiator');
  assert.equal(equippedModule(p, 'swift'), 'carburetor'); equipModule(p, '', 'universal'); assert.equal(equippedModule(p, 'universal'), ''); assert.equal(equippedModule(p, 'swift'), 'carburetor');
});

test('Legacy global modules migrate once to already owned planes without being inherited by later purchases', () => {
  const p = freshProfile('legacy-equipment'); delete p.equipmentVersion; delete p.planeEquipment;
  p.owned = ['universal', 'swift']; p.modules = ['radiator', 'carburetor', 'radiator', 'missing']; p.module = 'radiator';
  p.selected = 'swift'; const before = snapshot(p); assert.deepEqual(ownedModules(p), ['radiator', 'carburetor']); assert.equal(snapshot(p), before);
  const stats = planeStats(p), balances = {gold: p.gold, silver: p.silver, xp: p.xp}; normalizeProgression(p);
  assert.equal(p.equipmentVersion, 1); assert.deepEqual(ownedModules(p, 'universal'), ['radiator', 'carburetor']); assert.deepEqual(planeStats(p), stats);
  assert.deepEqual({gold: p.gold, silver: p.silver, xp: p.xp}, balances); const migrated = snapshot(p); normalizeProgression(p); assert.equal(snapshot(p), migrated);
  p.gold = 300; buyPlane(p, 'skate'); assert.deepEqual(ownedModules(p), []); assert.equal(equippedModule(p), '');
  p.selected = 'swift'; assert.equal(equippedModule(p), 'radiator');
  const oldUnnormalized = freshProfile('legacy-buy'); delete oldUnnormalized.equipmentVersion; oldUnnormalized.modules = ['carburetor']; oldUnnormalized.module = 'carburetor'; oldUnnormalized.gold = 300;
  buyPlane(oldUnnormalized, 'skate'); assert.deepEqual(ownedModules(oldUnnormalized), []); assert.deepEqual(ownedModules(oldUnnormalized, 'universal'), ['carburetor']);
});

test('Legacy invalid/unowned equipment cannot activate an unpaid module or leak into a newly purchased plane', () => {
  const p = freshProfile('invalid-equipment'); delete p.equipmentVersion; p.modules = ['missing']; p.module = 'radiator';
  p.planeEquipment = {swift: {owned: ['carburetor'], equipped: 'carburetor'}};
  assert.deepEqual(ownedModules(p), []); assert.equal(equippedModule(p), ''); normalizeProgression(p);
  assert.equal(p.planeEquipment!.swift, undefined); assert.deepEqual(ownedModules(p, 'swift'), []);
});
