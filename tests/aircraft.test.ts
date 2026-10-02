import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, PLANES, planeStats } from '../shared/data';
import { buyPlane } from '../server/economy';
test('Пять моделей: четыре за серебро и Феникс за золото, покупки и улучшения сохраняют прежние IDs', () => {
  assert.equal(PLANES.length, 5); assert.equal(PLANES.filter(p => p.currency === 'silver').length, 4);
  const p = freshProfile('pilot'); p.xp = 850; p.defeatedBosses = [10,25,50]; p.silver = 10000; p.gold = 300;
  p.owned.push('bastion'); p.upgrades.bastion = { hull: 2, engine: 1, gun: 0 }; p.selected = 'bastion';
  assert.equal(PLANES.find(x => x.id === p.selected)!.name, 'Рубин'); assert.equal(planeStats(p).hp, 535 * 1.12);
  for (const plane of PLANES) buyPlane(p, plane.id);
  assert.equal(p.owned.length, 5); assert.equal(p.silver, 5000); assert.equal(p.gold, 0);
  assert.equal(p.selected, 'skate'); assert.equal(planeStats(p).speed, 300);
  buyPlane(p, 'skate'); assert.equal(p.gold, 0);
});
test('Янтарь требует победу над боссом и серебро до списания средств', () => {
  const p = freshProfile('pilot'); p.silver = 2000;
  assert.throws(() => buyPlane(p, 'yantar')); assert.equal(p.silver, 2000); assert.deepEqual(p.owned, ['universal']);
  p.xp = 500; p.defeatedBosses = [25]; p.silver = 3799; assert.throws(() => buyPlane(p, 'yantar')); assert.equal(p.silver, 3799);
  p.silver = 3800; buyPlane(p, 'yantar'); assert.equal(p.silver, 0); assert.equal(p.selected, 'yantar');
});
