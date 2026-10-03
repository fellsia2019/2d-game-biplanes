import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { freshProfile, planeStats, equippedModule } from '../shared/data';
import { buyModule, equipModule, exchange, buyPlane } from '../server/economy';
import { verifyPurchases, redeemPurchases, PaymentAccount } from '../server/payments';
const secret = 'unit-test-secret-only', now = Date.now();
const purchases = [{ productID: 'gold300', purchaseToken: 'receipt-001', developerPayload: 'order-001' }];
function sign(data: unknown, issuedAt = Math.floor(now / 1000), algorithm = 'HMAC-SHA256') {
  const bytes = Buffer.from(JSON.stringify({ algorithm, issuedAt, data }));
  return createHmac('sha256', secret).update(bytes).digest('base64') + '.' + bytes.toString('base64');
}
test('Подпись проверяется по decoded JSON, подмена и ключ другой игры отклоняются', () => {
  assert.deepEqual(verifyPurchases(sign(purchases), secret, now), purchases);
  const proof = sign(purchases), forged = proof.split('.')[0] + '.' + Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: Math.floor(now / 1000), data: [{ ...purchases[0], productID: 'gold800' }] })).toString('base64');
  assert.throws(() => verifyPurchases(forged, secret, now));
  assert.throws(() => verifyPurchases(proof, 'different-game', now));
  assert.throws(() => verifyPurchases(proof, '', now));
});
test('Старые подписи, ответы шлюза и неизвестная схема не начисляют золото', () => {
  assert.throws(() => verifyPurchases(sign(purchases, Math.floor(now / 1000) - 400), secret, now));
  assert.throws(() => verifyPurchases(sign({ token: 'waiting', status: 'waiting' }), secret, now));
  assert.throws(() => verifyPurchases(sign(purchases, Math.floor(now / 1000), 'none'), secret, now));
  assert.throws(() => verifyPurchases(sign([{ productID: 'gold300' }]), secret, now));
});
test('Чек привязан к заказу ангара и сохраняется для однократного начисления', () => {
  const a: PaymentAccount = { profile: freshProfile('a'), orders: { 'order-001': { sku: 'gold300', createdAt: now } } };
  const b: PaymentAccount = { profile: freshProfile('b') };
  const first = redeemPurchases(a, [a, b], purchases, now);
  assert.equal(a.profile.gold, 300); assert.deepEqual(first.consume, ['receipt-001']);
  assert.deepEqual(redeemPurchases(a, [a, b], purchases, now).consume, ['receipt-001']); assert.equal(a.profile.gold, 300);
  const saved = JSON.parse(JSON.stringify(a)); redeemPurchases(saved, [saved, b], purchases, now); assert.equal(saved.profile.gold, 300);
  assert.throws(() => redeemPurchases(b, [a, b], purchases, now)); assert.equal(b.profile.gold, 0);
});
test('Неизвестный заказ/товар остаётся необработанным и не консумируется', () => {
  const a: PaymentAccount = { profile: freshProfile('a') };
  const result = redeemPurchases(a, [a], purchases, now);
  assert.equal(a.profile.gold, 0); assert.deepEqual(result.consume, []); assert.deepEqual(result.pending, ['gold300']);
});
test('Платный самолёт и модули покупаются за золото, отдельный слот каждого самолёта не даёт штрафов', () => {
  const p = freshProfile('pilot'); p.gold = 1000; p.defeatedBosses = [200];
  buyPlane(p, 'skate'); assert.equal(p.gold, 700); assert.equal(p.selected, 'skate');
  buyPlane(p, 'skate'); assert.equal(p.gold, 700);
  buyModule(p, 'carburetor'); assert.equal(p.gold, 580); assert.equal(planeStats(p).boostDuration, 3); assert.equal(planeStats(p).boostRecharge, 6);
  const originalDamage = planeStats(p).damage;
  buyModule(p, 'radiator'); assert.equal(p.gold, 460); assert.equal(equippedModule(p), 'radiator'); assert.equal(planeStats(p).cooling, 1.35); assert.equal(planeStats(p).damage, originalDamage);
  buyModule(p, 'radiator'); assert.equal(p.gold, 460);
  equipModule(p, ''); assert.equal(planeStats(p).cooling, 1); assert.equal(planeStats(p).boostDuration, 2);
  buyModule(p,'radiator','universal');assert.equal(p.gold,340);assert.equal(equippedModule(p,'universal'),'radiator');assert.equal(equippedModule(p,'skate'),'');assert.equal(planeStats(p).cooling,1);
  buyModule(p,'radiator','universal');assert.equal(p.gold,340);
  assert.equal(planeStats({...p,selected:'universal'}).cooling,1.35);
  assert.throws(() => equipModule(p, 'unknown'));
});
test('Обмен валидирует пакет и баланс до списания золота', () => {
  const p = freshProfile('pilot'); p.gold = 60;
  exchange(p, 50, 'silver'); assert.equal(p.gold, 10); assert.equal(p.silver, 1450);
  exchange(p, 10, 'xp'); assert.equal(p.gold, 0); assert.equal(p.xp, 80);
  const before = JSON.stringify(p); assert.throws(() => exchange(p, 10, 'xp')); assert.equal(JSON.stringify(p), before);
  assert.throws(() => exchange(p, -100, 'silver')); assert.throws(() => exchange(p, 10, 'gold'));
});
