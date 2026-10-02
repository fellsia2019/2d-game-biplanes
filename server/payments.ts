import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { GOLD_PACKS, Profile } from '../shared/data';
export interface Order { sku: string; createdAt: number }
export interface Receipt { sku: string; order: string; grantedAt: number }
export interface PaymentAccount { profile: Profile; orders?: Record<string, Order>; receipts?: Record<string, Receipt> }
// SDK signatures use HMAC over the decoded JSON bytes, not the base64 text.
// https://yandex.ru/dev/games/doc/ru/sdk/sdk-purchases
export function verifyPurchases(signature: string, secret: string, now = Date.now()): { productID: string; purchaseToken: string; developerPayload: string }[] {
  if (!secret) throw new Error('Покупки ещё не подключены');
  if (typeof signature !== 'string' || signature.length > 100000) throw new Error('Некорректная подпись покупки');
  const parts = signature.split('.');
  if (parts.length !== 2 || parts.some(x => !/^[A-Za-z0-9+/]+={0,2}$/.test(x))) throw new Error('Некорректная подпись покупки');
  const bytes = Buffer.from(parts[1], 'base64'), signatureBytes = Buffer.from(parts[0], 'base64');
  const expected = createHmac('sha256', secret).update(bytes).digest();
  if (signatureBytes.length !== expected.length || !timingSafeEqual(signatureBytes, expected)) throw new Error('Подпись покупки не подтверждена');
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (envelope.algorithm !== 'HMAC-SHA256' || !Number.isFinite(envelope.issuedAt) || now / 1000 - envelope.issuedAt > 300 || envelope.issuedAt - now / 1000 > 30) throw new Error('Обновите список покупок и повторите');
  // Grant only the completed purchase list returned by getPurchases().
  // A purchase() response can contain gateway state instead of this list.
  if (!Array.isArray(envelope.data) || envelope.data.length > 100) throw new Error('Нужен подтверждённый список покупок');
  for (const row of envelope.data) {
    if (!row || typeof row.productID !== 'string' || typeof row.purchaseToken !== 'string' || !row.purchaseToken || row.purchaseToken.length > 512 || typeof row.developerPayload !== 'string') throw new Error('Неизвестный формат покупки');
  }
  return envelope.data;
}
export function redeemPurchases(account: PaymentAccount, all: PaymentAccount[], purchases: ReturnType<typeof verifyPurchases>, now = Date.now()) {
  account.receipts ??= {}; account.orders ??= {};
  const consume: string[] = [], pending: string[] = [];
  for (const purchase of purchases) {
    const pack = GOLD_PACKS.find(x => x.id === purchase.productID);
    if (!pack) { pending.push(purchase.productID); continue; }
    const hash = createHash('sha256').update(purchase.purchaseToken).digest('hex');
    const owner = all.find(a => a.receipts?.[hash]);
    if (owner) {
      const receipt = owner.receipts![hash];
      if (owner !== account || receipt.sku !== pack.id || receipt.order !== purchase.developerPayload) throw new Error('Покупка принадлежит другому ангару');
      if (!consume.includes(purchase.purchaseToken)) consume.push(purchase.purchaseToken);
      continue;
    }
    const order = account.orders[purchase.developerPayload];
    if (!order || order.sku !== pack.id) { pending.push(pack.id); continue; }
    account.profile.gold += pack.gold;
    account.receipts[hash] = { sku: pack.id, order: purchase.developerPayload, grantedAt: now };
    consume.push(purchase.purchaseToken);
  }
  return { consume, pending };
}
