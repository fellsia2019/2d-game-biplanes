import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { GOLD_PACKS, Profile } from '../shared/data';
import { hasPremium, PREMIUM_PRODUCT_ID } from '../shared/premium';
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
  let envelope;
  try { envelope = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Некорректные данные покупки'); }
  if (!envelope || typeof envelope !== 'object' || envelope.algorithm !== 'HMAC-SHA256' || !Number.isFinite(envelope.issuedAt) || now / 1000 - envelope.issuedAt > 300 || envelope.issuedAt - now / 1000 > 30) throw new Error('Обновите список покупок и повторите');
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
  const consume = new Set<string>(), pending = new Set<string>();
  const grants = new Map<string, { purchase: typeof purchases[number]; gold: number; receipt: Receipt }>();
  let premiumSince: number | undefined;
  // Validate the complete list before granting. The server persists this change
  // atomically; a conflicting receipt must not leave a partial grant behind.
  for (const purchase of purchases) {
    const pack = GOLD_PACKS.find(x => x.id === purchase.productID);
    const permanent = purchase.productID === PREMIUM_PRODUCT_ID;
    if (!pack && !permanent) { pending.add(purchase.productID); continue; }
    const hash = createHash('sha256').update(purchase.purchaseToken).digest('hex');
    const owner = all.find(a => a.receipts?.[hash]) ?? (account.receipts[hash] ? account : undefined);
    const staged = grants.get(hash), receipt = owner?.receipts![hash] ?? staged?.receipt;
    if (receipt) {
      if ((owner && owner !== account) || receipt.sku !== purchase.productID || receipt.order !== purchase.developerPayload) throw new Error('Покупка принадлежит другому ангару');
      if (permanent) premiumSince = Math.min(premiumSince ?? Infinity, receipt.grantedAt);
      else consume.add(purchase.purchaseToken);
      continue;
    }
    const order = account.orders[purchase.developerPayload];
    if (!order || order.sku !== purchase.productID) { pending.add(purchase.productID); continue; }
    grants.set(hash, { purchase, gold: pack?.gold ?? 0, receipt: { sku: purchase.productID, order: purchase.developerPayload, grantedAt: now } });
    if (permanent) premiumSince = Math.min(premiumSince ?? Infinity, now);
    else consume.add(purchase.purchaseToken);
  }
  for (const [hash, grant] of grants) {
    account.profile.gold += grant.gold;
    account.receipts[hash] = grant.receipt;
  }
  if (premiumSince !== undefined) {
    const purchasedAt = hasPremium(account.profile) ? Math.min(account.profile.premium!.purchasedAt, premiumSince) : premiumSince;
    account.profile.premium = { active: true, purchasedAt };
  }
  return { consume: [...consume], pending: [...pending] };
}
