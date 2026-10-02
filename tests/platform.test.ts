import test from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from '../src/platform';
const token = 'a'.repeat(64);
function mock(options: { anonymous?: boolean; storageFailure?: boolean } = {}) {
  const events: string[] = [], cloud = { biplanesToken: token };
  const sdk = {
    features: {}, on() {}, auth: { async openAuthDialog() {} },
    async getPlayer() { return {
      isAuthorized: () => !options.anonymous,
      async getData() { if (options.storageFailure) throw new Error('Cloud unavailable'); return cloud; },
      async setData(data: object) { events.push('cloud-write'); Object.assign(cloud, data); },
    }; },
    async getPayments() { return {
      async getCatalog() { return [{ id: 'gold300', price: '99 YAN', priceValue: '99', priceCurrencyCode: 'YAN' }]; },
      async purchase() { events.push('paid'); return { signature: 'single-purchase-response' }; },
      async getPurchases() { events.push('signed-list'); return { signature: 'completed-list-response' }; },
      async consumePurchase() { events.push('consumed'); },
    }; },
  };
  Object.assign(globalThis, { window: { YaGames: { init: async () => sdk } }, localStorage: { getItem: () => token }, location: { hostname: '127.0.0.1' } });
  return { events, cloud };
}
test('Клиент консумирует чек только после серверного подтверждения сохранения', async () => {
  const { events } = mock(), platform = new Platform(); await platform.init(() => {});
  assert.equal(platform.getToken(), token);
  await platform.purchase('gold300', async (type, data: any) => {
    if (type === 'payment-order') { events.push('order-saved'); return { id: 'order-id' }; }
    assert.equal(data.signature, 'completed-list-response'); events.push('grant-saved'); return { consume: ['receipt'], pending: [] };
  });
  assert.deepEqual(events, ['order-saved', 'paid', 'signed-list', 'grant-saved', 'consumed']);
});
test('Серверная ошибка после оплаты оставляет чек для восстановления', async () => {
  const { events } = mock(), platform = new Platform(); await platform.init(() => {});
  await assert.rejects(platform.purchase('gold300', async type => { if (type === 'payment-order') return { id: 'order' }; throw new Error('Disk unavailable'); }), /Оплата завершена/);
  assert.equal(events.includes('consumed'), false);
  await platform.recover(async () => ({ consume: ['receipt'], pending: [] }));
  assert.equal(events.filter(x => x === 'consumed').length, 1);
});
test('Одновременные запросы восстановления используют один поток консумирования', async () => {
  const { events } = mock(), platform = new Platform(); await platform.init(() => {});
  await Promise.all([platform.recover(async () => ({ consume: ['receipt'], pending: [] })), platform.recover(async () => ({ consume: ['receipt'], pending: [] }))]);
  assert.equal(events.filter(x => x === 'consumed').length, 1);
});
test('Ошибка чтения облака не перезаписывает существующий ангар и блокирует оплату', async () => {
  const { events } = mock({ storageFailure: true }), platform = new Platform(); await platform.init(() => {});
  await assert.rejects(platform.rememberToken('b'.repeat(64))); assert.equal(events.includes('cloud-write'), false);
  assert.equal(platform.canPay, false);
});
test('Гостю доступна игра, а покупки требуют сохранения в аккаунте Яндекса', async () => {
  mock({ anonymous: true }); const platform = new Platform(); await platform.init(() => {});
  await platform.rememberToken(token); assert.equal(platform.canPay, false);
  await assert.rejects(platform.purchase('gold300', async () => undefined));
});
