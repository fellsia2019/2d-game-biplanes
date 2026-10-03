import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { freshProfile, campaignReward, planeStats, ZONE, claimTask, resetTasks } from '../shared/data';
import { combatReward, hasPremium, PREMIUM_PRODUCT_ID, premiumCombatReward } from '../shared/premium';
import { type PaymentAccount, redeemPurchases, verifyPurchases } from '../server/payments';
import { createBattle, makePlane, stepBattle, IDLE, beginBoss, forfeitDuel } from '../shared/simulation';
import { exchange } from '../server/economy';

const now = 1770000000000, secret = 'premium-unit-tests-only';
const purchase = { productID: PREMIUM_PRODUCT_ID, purchaseToken: 'premium-receipt-1', developerPayload: 'premium-order-1' };
function account(id = 'a'): PaymentAccount {
  return { profile: freshProfile(id), orders: { [purchase.developerPayload]: { sku: PREMIUM_PRODUCT_ID, createdAt: now - 1000 } } };
}
function signed(data: unknown) {
  const bytes = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: now / 1000, data }));
  return createHmac('sha256', secret).update(bytes).digest('base64') + '.' + bytes.toString('base64');
}

test('Подписанная покупка выдаёт пожизненный премиум без золота и без consumePurchase', () => {
  const a = account(), before = { gold: a.profile.gold, silver: a.profile.silver, xp: a.profile.xp };
  const result = redeemPurchases(a, [a], verifyPurchases(signed([purchase]), secret, now), now);
  assert.deepEqual(result, { consume: [], pending: [] });
  assert.deepEqual(a.profile.premium, { active: true, purchasedAt: now });
  assert.equal(hasPremium(a.profile), true);
  assert.deepEqual({ gold: a.profile.gold, silver: a.profile.silver, xp: a.profile.xp }, before);
  assert.equal(Object.keys(a.receipts!).length, 1);
});

test('Повторный чек и его дубликат в списке не меняют премиум и дату покупки', () => {
  const a = account();
  redeemPurchases(a, [a], [purchase, purchase], now);
  const before = JSON.stringify(a);
  assert.deepEqual(redeemPurchases(a, [a], [purchase], now + 86400000), { consume: [], pending: [] });
  assert.equal(JSON.stringify(a), before);
});

test('Премиум сохраняется после перезапуска и восстанавливается из постоянного чека', () => {
  const a = account(); redeemPurchases(a, [a], [purchase], now);
  const saved: PaymentAccount = JSON.parse(JSON.stringify(a));
  assert.equal(hasPremium(saved.profile), true);
  delete saved.profile.premium;
  const nextNow = now + 86400000;
  const bytes = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: nextNow / 1000, data: [purchase] }));
  const proof = createHmac('sha256', secret).update(bytes).digest('base64') + '.' + bytes.toString('base64');
  assert.deepEqual(redeemPurchases(saved, [saved], verifyPurchases(proof, secret, nextNow), nextNow), { consume: [], pending: [] });
  assert.deepEqual(saved.profile.premium, { active: true, purchasedAt: now });
  assert.equal(Object.keys(saved.receipts!).length, 1);
});

test('Потеря связи до выдачи: сохранённый заказ подтверждается свежим getPurchases', () => {
  const saved: PaymentAccount = JSON.parse(JSON.stringify(account()));
  assert.equal(hasPremium(saved.profile), false);
  redeemPurchases(saved, [saved], verifyPurchases(signed([purchase]), secret, now), now);
  assert.equal(hasPremium(saved.profile), true);
});

test('Премиум не переносится между ангарами и не выдаётся по неизвестному заказу', () => {
  const a = account(), b = account('b'); delete b.orders;
  assert.deepEqual(redeemPurchases(b, [a, b], [purchase], now), { consume: [], pending: [PREMIUM_PRODUCT_ID] });
  assert.equal(hasPremium(b.profile), false);
  redeemPurchases(a, [a, b], [purchase], now);
  assert.throws(() => redeemPurchases(b, [a, b], [purchase], now), /другому ангару/);
  assert.equal(hasPremium(b.profile), false);
  assert.equal(Object.keys(b.receipts!).length, 0);
  assert.throws(() => redeemPurchases(a, [a, b], [{ ...purchase, developerPayload: 'other-order' }], now), /другому ангару/);
});

test('Подмена премиум-товара, ключа или устаревшая подпись не дают доступ', () => {
  const a = account(), before = JSON.stringify(a), proof = signed([purchase]);
  const forged = proof.split('.')[0] + '.' + Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: now / 1000, data: [{ ...purchase, productID: 'gold800' }] })).toString('base64');
  for (const [signature, key, time] of [[forged, secret, now], [proof, 'other-game', now], [proof, secret, now + 301000]] as const) {
    assert.throws(() => redeemPurchases(a, [a], verifyPurchases(signature, key, time), time));
    assert.equal(JSON.stringify(a), before);
  }
});

test('Постоянный премиум и расходуемое золото в одном списке обрабатываются раздельно', () => {
  const a = account(), gold = { productID: 'gold300', purchaseToken: 'gold-receipt-1', developerPayload: 'gold-order-1' };
  a.orders![gold.developerPayload] = { sku: gold.productID, createdAt: now };
  assert.deepEqual(redeemPurchases(a, [a], [purchase, gold, purchase, gold], now), { consume: [gold.purchaseToken], pending: [] });
  assert.equal(a.profile.gold, 300); assert.equal(hasPremium(a.profile), true);
  const saved: PaymentAccount = JSON.parse(JSON.stringify(a));
  assert.deepEqual(redeemPurchases(saved, [saved], [purchase, gold], now + 1000), { consume: [gold.purchaseToken], pending: [] });
  assert.equal(saved.profile.gold, 300);
});

test('Конфликт в смешанном списке не оставляет частичную выдачу', () => {
  const a = account(), b = account('b'), gold = { productID: 'gold300', purchaseToken: 'gold-receipt-owned', developerPayload: 'gold-order-owned' };
  b.orders![gold.developerPayload] = { sku: gold.productID, createdAt: now };
  redeemPurchases(b, [a, b], [gold], now);
  const before = JSON.stringify(a.profile);
  assert.throws(() => redeemPurchases(a, [a, b], [purchase, gold], now), /другому ангару/);
  assert.equal(JSON.stringify(a.profile), before);
  assert.equal(Object.keys(a.receipts!).length, 0);
  assert.throws(() => redeemPurchases(a, [a, b], [purchase, { ...purchase, productID: 'gold300' }], now), /другому ангару/);
  assert.equal(Object.keys(a.receipts!).length, 0);
});

test('Премиум даёт +50% только через расчёт боевых наград с целым округлением', () => {
  const a = account();
  assert.equal(premiumCombatReward(45, a.profile), 45);
  redeemPurchases(a, [a], [purchase], now);
  assert.equal(premiumCombatReward(45, a.profile), 68);
  assert.equal(premiumCombatReward(campaignReward(90), a.profile), 68);
  assert.equal(premiumCombatReward(300, a.profile), 450);
  assert.equal(premiumCombatReward(0, a.profile), 0);
  assert.equal(combatReward(17, 1.5), 26);
  assert.equal(combatReward(17), 17);
  // A purchase does not multiply existing balances or total earned XP.
  assert.equal(a.profile.silver, 200); assert.equal(a.profile.xp, 0);
  assert.equal(hasPremium({ premium: { active: true, purchasedAt: Number.NaN } }), false);
  assert.equal(hasPremium({ premium: { active: true, purchasedAt: 0 } }), false);
});

test('Боевой движок начисляет премиум после уменьшения кампании, включая босса и HUD', () => {
  for (const level of [1, 10]) {
    const run = (premium: boolean) => {
      const a = account(); if (premium) redeemPurchases(a, [a], [purchase], now);
      const state = createBattle('premium-battle', 'pve', [makePlane(a.profile.id, planeStats(a.profile, true))], level);
      state.distance = ZONE[level - 1].length; state.spawn = 9999;
      if (level === 10) { beginBoss(state); state.planes[1].health = 0; }
      const rewards = stepBattle(state, { [a.profile.id]: IDLE }, 0);
      return { state, rewards };
    };
    const base = run(false), paid = run(true); assert.equal(base.rewards.length, paid.rewards.length);
    for (let i = 0; i < base.rewards.length; i++) {
      assert.equal(paid.rewards[i].silver, Math.round(base.rewards[i].silver * 1.5));
      assert.equal(paid.rewards[i].xp, Math.round(base.rewards[i].xp * 1.5));
    }
    assert.equal(paid.state.earned.a.silver, paid.rewards.reduce((sum, r) => sum + r.silver, 0));
    assert.equal(paid.state.earned.a.xp, paid.rewards.reduce((sum, r) => sum + r.xp, 0));
    if (level === 1) { assert.equal(paid.rewards[0].silver, 68); assert.equal(paid.rewards[0].xp, 26); }
    else assert.ok(paid.rewards.some(r => r.bossLevel === 10));
  }
});

test('Премиум в дуэли повышает боевую награду только владельцу', () => {
  const run = (premium: boolean) => {
    const a = account(); if (premium) redeemPurchases(a, [a], [purchase], now);
    const b = freshProfile('b'), state = createBattle('premium-duel', 'duel', [makePlane(a.profile.id, planeStats(a.profile)), makePlane(b.id, planeStats(b), false, 1)]);
    state.activity.a = state.activity.b = 5;
    return forfeitDuel(state, b.id);
  };
  const base = run(false), paid = run(true);
  assert.equal(base.find(r => r.player === 'a')!.silver, 120);
  assert.equal(paid.find(r => r.player === 'a')!.silver, 180);
  assert.equal(paid.find(r => r.player === 'a')!.xp, 90);
  assert.deepEqual(paid.find(r => r.player === 'b'), base.find(r => r.player === 'b'));
});

test('Задачи и обмен получают обычную награду даже у владельца премиума', () => {
  const a = account(); redeemPurchases(a, [a], [purchase], now);
  resetTasks(a.profile); a.profile.daily.kills = 5;
  assert.equal(claimTask(a.profile, 'daily', 'kills'), true);
  assert.equal(a.profile.silver, 300); assert.equal(a.profile.xp, 30);
  a.profile.gold = 60; exchange(a.profile, 50, 'silver'); exchange(a.profile, 10, 'xp');
  assert.equal(a.profile.silver, 1550); assert.equal(a.profile.xp, 110); assert.equal(a.profile.gold, 0);
});
