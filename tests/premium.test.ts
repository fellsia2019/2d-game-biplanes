import test, {before, after, mock} from 'node:test';
import { readyLastSortie } from './fixtures';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { freshProfile, campaignReward, planeStats, ZONE, claimTask, resetTasks } from '../shared/data';
import { combatReward, hasPremium, premiumExpiresAt, normalizePremium, PREMIUM_DURATION_MS, PREMIUM_PRODUCT_ID, premiumCombatReward } from '../shared/premium';
import { type PaymentAccount, redeemPurchases, verifyPurchases } from '../server/payments';
import { createBattle, makePlane, stepBattle, IDLE, beginBoss, forfeitDuel, finishSortie, refreshPlaneStats, type Battle } from '../shared/simulation';
import { exchange } from '../server/economy';
import { operationMission, sortieReward } from '../shared/operations';

const now = 1770000000000, secret = 'premium-unit-tests-only';
before(() => mock.timers.enable({apis:['Date'],now}));
after(() => mock.timers.reset());
const purchase = { productID: PREMIUM_PRODUCT_ID, purchaseToken: 'premium-receipt-1', developerPayload: 'premium-order-1' };
function account(id = 'a'): PaymentAccount {
  return { profile: freshProfile(id), orders: { [purchase.developerPayload]: { sku: PREMIUM_PRODUCT_ID, createdAt: now - 1000 } } };
}
function signed(data: unknown) {
  const bytes = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: now / 1000, data }));
  return createHmac('sha256', secret).update(bytes).digest('base64') + '.' + bytes.toString('base64');
}

test('Подписанная покупка выдаёт 30 дней премиума без золота и возвращает токен для consumePurchase', () => {
  const a = account(), before = { gold: a.profile.gold, silver: a.profile.silver, xp: a.profile.xp };
  const result = redeemPurchases(a, [a], verifyPurchases(signed([purchase]), secret, now), now);
  assert.deepEqual(result, { consume: [purchase.purchaseToken], pending: [] });
  assert.deepEqual(a.profile.premium, { active: true, purchasedAt: now, expiresAt:now+PREMIUM_DURATION_MS });
  assert.equal(hasPremium(a.profile), true);
  assert.deepEqual({ gold: a.profile.gold, silver: a.profile.silver, xp: a.profile.xp }, before);
  assert.equal(Object.keys(a.receipts!).length, 1);
});

test('Повторный чек и его дубликат в списке не меняют премиум и дату покупки', () => {
  const a = account();
  redeemPurchases(a, [a], [purchase, purchase], now);
  const before = JSON.stringify(a);
  assert.deepEqual(redeemPurchases(a, [a], [purchase], now + 86400000), { consume: [purchase.purchaseToken], pending: [] });
  assert.equal(JSON.stringify(a), before);
});

test('Премиум сохраняется после перезапуска и восстанавливает исходный срок из сохранённого чека', () => {
  const a = account(); redeemPurchases(a, [a], [purchase], now);
  const saved: PaymentAccount = JSON.parse(JSON.stringify(a));
  assert.equal(hasPremium(saved.profile), true);
  delete saved.profile.premium;
  const nextNow = now + 86400000;
  const bytes = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: nextNow / 1000, data: [purchase] }));
  const proof = createHmac('sha256', secret).update(bytes).digest('base64') + '.' + bytes.toString('base64');
  assert.deepEqual(redeemPurchases(saved, [saved], verifyPurchases(proof, secret, nextNow), nextNow), { consume: [purchase.purchaseToken], pending: [] });
  assert.deepEqual(saved.profile.premium, { active: true, purchasedAt: now, expiresAt:now+PREMIUM_DURATION_MS });
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

test('Премиум и золото в одном списке выдаются один раз и оба чека консумируются', () => {
  const a = account(), gold = { productID: 'gold300', purchaseToken: 'gold-receipt-1', developerPayload: 'gold-order-1' };
  a.orders![gold.developerPayload] = { sku: gold.productID, createdAt: now };
  assert.deepEqual(redeemPurchases(a, [a], [purchase, gold, purchase, gold], now), { consume: [purchase.purchaseToken,gold.purchaseToken], pending: [] });
  assert.equal(a.profile.gold, 300); assert.equal(hasPremium(a.profile), true);
  const saved: PaymentAccount = JSON.parse(JSON.stringify(a));
  assert.deepEqual(redeemPurchases(saved, [saved], [purchase, gold], now + 1000), { consume: [purchase.purchaseToken,gold.purchaseToken], pending: [] });
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

test('Ровно на границе 30 дней премиум и бонус прекращаются, legacy срок не зависит от входа', () => {
  const p=freshProfile('expiry');p.premium={active:true,purchasedAt:now};
  assert.equal(premiumExpiresAt(p),now+PREMIUM_DURATION_MS);
  assert.equal(hasPremium(p,now+PREMIUM_DURATION_MS-1),true);
  assert.equal(premiumCombatReward(45,p,now+PREMIUM_DURATION_MS-1),68);
  assert.equal(hasPremium(p,now+PREMIUM_DURATION_MS),false);
  assert.equal(premiumCombatReward(45,p,now+PREMIUM_DURATION_MS),45);
  normalizePremium(p);assert.equal(p.premium.expiresAt,now+PREMIUM_DURATION_MS);
  normalizePremium(p);assert.equal(p.premium.expiresAt,now+PREMIUM_DURATION_MS);
  p.premium.expiresAt=Number.NaN;assert.equal(hasPremium(p,now),false);
});

test('Новая оплата продлевает активный срок и начинает месяц от оплаты после истечения; повторы не продлевают', () => {
  const a=account();redeemPurchases(a,[a],[purchase],now);
  const extension={...purchase,purchaseToken:'extension-1',developerPayload:'extension-order-1'};
  a.orders![extension.developerPayload]={sku:PREMIUM_PRODUCT_ID,createdAt:now+86400000};
  redeemPurchases(a,[a],[purchase,extension,extension],now+86400000);
  assert.equal(a.profile.premium!.expiresAt,now+2*PREMIUM_DURATION_MS);
  const saved:PaymentAccount=JSON.parse(JSON.stringify(a));delete saved.profile.premium;
  redeemPurchases(saved,[saved],[purchase],now+3*PREMIUM_DURATION_MS);
  assert.equal(saved.profile.premium!.expiresAt,now+2*PREMIUM_DURATION_MS);assert.equal(hasPremium(saved.profile,now+3*PREMIUM_DURATION_MS),false);
  const renewal={...purchase,purchaseToken:'renewal-1',developerPayload:'renewal-order-1'};
  saved.orders![renewal.developerPayload]={sku:PREMIUM_PRODUCT_ID,createdAt:now+3*PREMIUM_DURATION_MS};
  redeemPurchases(saved,[saved],[renewal,renewal],now+3*PREMIUM_DURATION_MS);
  assert.equal(saved.profile.premium!.expiresAt,now+4*PREMIUM_DURATION_MS);
  const before=JSON.stringify(saved);redeemPurchases(saved,[saved],[purchase,extension,renewal],now+5*PREMIUM_DURATION_MS);assert.equal(JSON.stringify(saved),before);
});

test('Старый receipt восстанавливает только первоначальные 30 дней и не дарит срок при каждом входе', () => {
  const a=account();redeemPurchases(a,[a],[purchase],now);
  const second={...purchase,purchaseToken:'legacy-second-receipt',developerPayload:'legacy-second-order'};
  a.orders![second.developerPayload]={sku:PREMIUM_PRODUCT_ID,createdAt:now+86400000};redeemPurchases(a,[a],[second],now+86400000);
  delete a.profile.premium;
  for(const receipt of Object.values(a.receipts!)){delete receipt.premiumExpiresAt;delete receipt.premiumPurchasedAt;}
  redeemPurchases(a,[a],[purchase],now+2*PREMIUM_DURATION_MS);
  assert.deepEqual(a.profile.premium,{active:true,purchasedAt:now,expiresAt:now+PREMIUM_DURATION_MS});
  assert.equal(hasPremium(a.profile,now+2*PREMIUM_DURATION_MS),false);
  const before=JSON.stringify(a);redeemPurchases(a,[a],[purchase],now+3*PREMIUM_DURATION_MS);assert.equal(JSON.stringify(a),before);
});

test('Боевой движок начисляет премиум после уменьшения кампании, включая все гарантии вылетов, босса и HUD', () => {
  const floors = new Map([[1, [180, 60]], [26, [510, 150]], [101, [810, 240]], [201, [1110, 345]]]);
  for (const level of [...floors.keys(), 10]) {
    const run = (premium: boolean) => {
      const a = account(); if (premium) redeemPurchases(a, [a], [purchase], now);
      const state = createBattle('premium-battle', 'pve', [makePlane(a.profile.id, planeStats(a.profile, true))], level);
      state.distance = ZONE[level - 1].length; state.spawn = 9999;
      if (level !== 10) readyLastSortie(state);
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
    if (level !== 10) {
      assert.equal(paid.rewards.find(r=>r.kind==='level')!.silver,135); assert.equal(paid.rewards.find(r=>r.kind==='level')!.xp,60);
      const [silver, xp] = floors.get(level)!;
      assert.equal(paid.rewards.find(r=>r.kind==='sortie')!.silver,silver); assert.equal(paid.rewards.find(r=>r.kind==='sortie')!.xp,xp);
    }
    else assert.ok(paid.rewards.some(r => r.bossLevel === 10));
  }
});

test('Сохранённые выплаты за цели вычитаются из премиум-гарантии ровно один раз, новый вылет начинает свой учёт', () => {
  for (const level of [14, 30, 102, 202]) for (const premiumBeforeKills of [true, false]) {
    const a = account(); if (premiumBeforeKills) redeemPurchases(a, [a], [purchase], now);
    const state = createBattle('premium-ledger-' + level, 'pve', [makePlane(a.profile.id, planeStats(a.profile, true))], level);
    state.spawn = 9999; state.bomberClock = 9999;
    state.obstacles = [
      {id:10, kind:'fighter', x:500, y:330, radius:24, hp:1, fire:100, damage:1},
      {id:11, kind:'heavy', x:750, y:340, radius:32, hp:1, fire:100, damage:1},
    ];
    state.bullets = state.obstacles.map(o => ({id:o.id+10, owner:a.profile.id, x:o.x, y:o.y, vx:0, vy:0, life:1, damage:10}));
    const kills = stepBattle(state, {[a.profile.id]:IDLE}, 0);
    assert.equal(kills.length, 2); assert.ok(kills.every(r => r.kind === 'kill'));
    for (const [i, factor] of [1, 1.6].entries()) {
      assert.equal(kills[i].silver, premiumCombatReward(campaignReward(Math.round(ZONE[level-1].killSilver*factor)), a.profile));
      assert.equal(kills[i].xp, premiumCombatReward(campaignReward(Math.round(ZONE[level-1].killXp*factor)), a.profile));
    }
    const paid = kills.reduce((sum,r) => ({silver:sum.silver+r.silver, xp:sum.xp+r.xp}), {silver:0,xp:0});
    assert.equal(state.operation!.killSilver,paid.silver); assert.equal(state.operation!.killXp,paid.xp);
    const restored: Battle = JSON.parse(JSON.stringify(state));
    if (!premiumBeforeKills) redeemPurchases(a, [a], [purchase], now);
    refreshPlaneStats(restored.planes[0], planeStats(a.profile, true));
    const complete = () => {
      const mission = operationMission(level, restored.operation!.completed);
      Object.assign(restored.operation!, {seconds:mission.seconds, kills:Math.max(restored.operation!.kills,mission.targetKills), specialKills:mission.targetSpecial, collected:mission.targetPickups});
      return stepBattle(restored, {[a.profile.id]:IDLE}, 0);
    };
    const budget = sortieReward(level), floor = {silver:premiumCombatReward(campaignReward(budget.silver),a.profile), xp:premiumCombatReward(campaignReward(budget.xp),a.profile)};
    const topUp = complete(); assert.equal(topUp.length,1); assert.equal(topUp[0].kind,'sortie');
    assert.equal(topUp[0].silver,floor.silver-paid.silver); assert.equal(topUp[0].xp,floor.xp-paid.xp);
    assert.deepEqual(restored.earned[a.profile.id],floor); assert.equal(restored.operation!.killSilver,paid.silver); assert.equal(restored.operation!.killXp,paid.xp);
    assert.deepEqual(stepBattle(restored, {[a.profile.id]:IDLE}, 1/30),[]); assert.deepEqual(restored.earned[a.profile.id],floor);
    finishSortie(restored); assert.equal(restored.operation!.killSilver,0); assert.equal(restored.operation!.killXp,0);
    const next = complete(); assert.equal(next.length,1); assert.equal(next[0].silver,floor.silver); assert.equal(next[0].xp,floor.xp);
    assert.deepEqual(restored.earned[a.profile.id],{silver:floor.silver*2,xp:floor.xp*2});
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
