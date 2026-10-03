import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPGRADE_LEVEL, freshProfile, PLANES, planeStats } from '../shared/data';
import { buyPlane } from '../server/economy';
test('Пять моделей: четыре за серебро и Феникс за золото, покупки и улучшения сохраняют прежние IDs', () => {
  assert.equal(PLANES.length, 5); assert.equal(PLANES.filter(p => p.currency === 'silver').length, 4);
  const p = freshProfile('pilot'); p.xp = 850; p.defeatedBosses = [25,100,200]; p.silver = 100000; p.gold = 300;
  for (const model of ['universal','swift','yantar']) p.upgrades[model] = { hull: MAX_UPGRADE_LEVEL, engine: MAX_UPGRADE_LEVEL, gun: MAX_UPGRADE_LEVEL };
  p.owned.push('bastion'); p.upgrades.bastion = { hull: 2, engine: 1, gun: 0 }; p.selected = 'bastion';
  assert.equal(PLANES.find(x => x.id === p.selected)!.name, 'Рубин'); assert.equal(planeStats(p).hp, 535 * 1.04);
  const silverCost = PLANES.filter(plane => plane.currency === 'silver' && !p.owned.includes(plane.id)).reduce((sum, plane) => sum + plane.price, 0);
  for (const plane of PLANES) buyPlane(p, plane.id);
  assert.equal(p.owned.length, 5); assert.equal(p.silver, 100000-silverCost); assert.equal(p.gold, 0); assert.equal(p.xp,850);
  assert.equal(p.selected, 'skate'); assert.equal(planeStats(p).speed, 210);
  buyPlane(p, 'skate'); assert.equal(p.gold, 0);
});
test('Янтарь требует босса 100, полностью купленные улучшения Стрижа и серебро до списания средств', () => {
  const p = freshProfile('pilot'); p.silver = 2000;
  assert.throws(() => buyPlane(p, 'yantar')); assert.equal(p.silver, 2000); assert.deepEqual(p.owned, ['universal']);
  const yantar = PLANES.find(plane => plane.id === 'yantar')!;
  p.xp = 500; p.defeatedBosses = [100]; p.silver = yantar.price; p.owned.push('swift');
  assert.throws(() => buyPlane(p,'yantar'), /улучш|прокач/i); assert.equal(p.silver,yantar.price);
  p.upgrades.swift = { hull: MAX_UPGRADE_LEVEL, engine: MAX_UPGRADE_LEVEL, gun: MAX_UPGRADE_LEVEL };
  p.silver = yantar.price - 1; assert.throws(() => buyPlane(p, 'yantar'), /Недостаточно/); assert.equal(p.silver, yantar.price - 1);
  p.silver = yantar.price; buyPlane(p, 'yantar'); assert.equal(p.silver, 0); assert.equal(p.selected, 'yantar');
});
