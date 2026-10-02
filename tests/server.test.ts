import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, rename, mkdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { WebSocket } from 'ws';
import { randomUUID, createHmac } from 'node:crypto';
import { freshProfile, resetTasks } from '../shared/data';
class Peer {
  ws: WebSocket; messages: any[] = []; waiters: { predicate: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  constructor() {
    this.ws = new WebSocket('ws://127.0.0.1:5197/socket');
    this.ws.on('message', raw => { const m = JSON.parse(raw.toString()); this.messages.push(m); for (const w of [...this.waiters]) if (w.predicate(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); } });
  }
  async open() { await new Promise<void>((r, j) => { this.ws.once('open', r); this.ws.once('error', j); }); }
  send(m: object) { const request = m as Record<string, unknown>; if (['buy', 'module-buy', 'exchange'].includes(request.type as string) && !request.nonce) request.nonce = randomUUID(); this.ws.send(JSON.stringify(request)); }
  async wait(predicate: (m: any) => boolean, timeout = 5000) {
    return new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== waiter); reject(new Error('Истекло ожидание сообщения')); }, timeout);
      const waiter = { predicate, resolve: (m: any) => { clearTimeout(t); resolve(m); } }; this.waiters.push(waiter);
    });
  }
  async auth(token?: string) { const welcome = this.wait(m => m.type === 'welcome'), profile = this.wait(m => m.type === 'profile'); this.send({ type: 'auth', token }); return { welcome: await welcome, profile: (await profile).profile }; }
  async rpc(type: string, data: object = {}) { const requestId = randomUUID(), reply = this.wait(m => m.type === 'reply' && m.requestId === requestId); this.send({ type, requestId, ...data }); const result = await reply; if (!result.ok) throw new Error(result.error); return result.result; }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('Сервер: онлайн 1×1, кошелёк, сохранение, очередь 15 секунд и отмена', { timeout: 50000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'biplanes-test-'));
  const shopProfile = freshProfile('shop-pilot'); shopProfile.silver = 5000; shopProfile.xp = 500; resetTasks(shopProfile); shopProfile.daily.kills = 5;
  const pastTaskKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  shopProfile.taskArchive.push({ period: 'daily', key: pastTaskKey, completed: ['activity'], claimed: [], expiresAt: Date.now() + 86400000 });
  await writeFile(join(dir, 'profiles.json'), JSON.stringify([
    { token: 'shop-test-token', profile: shopProfile },
    { token: 'boss-test-token', profile: freshProfile('boss-pilot'), restartLevel: 10, restartBoss: true },
  ]));
  const paymentKey = 'server-integration-test-secret';
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: '5197', BIPLANES_DATA: join(dir, 'profiles.json'), YANDEX_PAYMENT_SECRET: paymentKey }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {});
  const peers: Peer[] = [];
  try {
    await new Promise<void>((r, j) => { proc.stdout.on('data', d => { if (String(d).includes('Сервер Бипланы')) r(); }); proc.once('exit', code => j(new Error('Сервер не запустился: ' + code))); setTimeout(() => j(new Error('Server startup timeout')), 6000).unref(); });
    const shop = new Peer(), bossPeer = new Peer(); peers.push(shop, bossPeer); await Promise.all([shop.open(), bossPeer.open()]);
    await shop.auth('shop-test-token'); await bossPeer.auth('boss-test-token');
    const bought = shop.wait(m => m.type === 'profile'); shop.send({ type: 'buy', id: 'swift' }); const boughtProfile = (await bought).profile;
    assert.equal(boughtProfile.silver, 4400); assert.equal(boughtProfile.selected, 'swift');
    const upgraded = shop.wait(m => m.type === 'profile'); shop.send({ type: 'upgrade', branch: 'hull' }); const upgradedProfile = (await upgraded).profile;
    assert.equal(upgradedProfile.silver, 4300); assert.equal(upgradedProfile.upgrades.swift.hull, 1);
    const claimed = shop.wait(m => m.type === 'profile'); shop.send({ type: 'claim', period: 'daily', id: 'kills' }); assert.equal((await claimed).profile.silver, 4400);
    shop.send({ type: 'claim', period: 'daily', id: 'kills' });
    const upgradedRun = shop.wait(m => m.type === 'start'); shop.send({ type: 'pve' }); const upgradedState = (await upgradedRun).battle;
    assert.equal(upgradedState.planes[0].model, 'swift'); assert.ok(Math.abs(upgradedState.planes[0].hp - 92.7) < .001);
    const shopMenu = shop.wait(m => m.type === 'profile'); shop.send({ type: 'leave' }); assert.equal((await shopMenu).profile.silver, 4400);
    const bossRetry = bossPeer.wait(m => m.type === 'start'); bossPeer.send({ type: 'pve' }); const retryState = (await bossRetry).battle;
    assert.equal(retryState.phase, 'boss'); assert.equal(retryState.level, 10); assert.equal(retryState.planes[1].health, 250);
    const bossMenu = bossPeer.wait(m => m.type === 'profile'); bossPeer.send({ type: 'leave' }); await bossMenu;
    const order = await shop.rpc('payment-order', { sku: 'gold300' });
    const receipt = { productID: 'gold300', purchaseToken: 'server-receipt-1', developerPayload: order.id };
    const bytes = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: Math.floor(Date.now() / 1000), data: [receipt] }));
    const signature = createHmac('sha256', paymentKey).update(bytes).digest('base64') + '.' + bytes.toString('base64');
    const credited = await shop.rpc('payment-redeem', { signature }); assert.deepEqual(credited.consume, [receipt.purchaseToken]);
    // ACK is emitted only after the wallet and receipt are present on disk.
    const stored = JSON.parse(await readFile(join(dir, 'profiles.json'), 'utf8')).find((x: any) => x.profile.id === 'shop-pilot');
    assert.equal(stored.profile.gold, 300); assert.equal(Object.keys(stored.receipts).length, 1);
    await shop.rpc('payment-redeem', { signature });
    assert.equal(shop.messages.filter(m => m.type === 'profile').at(-1).profile.gold, 300);
    const exchangeNonce = randomUUID();
    const exchangeProfile = shop.wait(m => m.type === 'profile'); shop.send({ type: 'exchange', nonce: exchangeNonce, amount: 50, currency: 'silver' }); assert.equal((await exchangeProfile).profile.gold, 250);
    const duplicateExchange = shop.wait(m => m.type === 'profile'); shop.send({ type: 'exchange', nonce: exchangeNonce, amount: 50, currency: 'silver' }); assert.equal((await duplicateExchange).profile.gold, 250);
    const mod = shop.wait(m => m.type === 'profile'); shop.send({ type: 'module-buy', id: 'carburetor' }); const modProfile = (await mod).profile;
    assert.equal(modProfile.gold, 130); assert.equal(modProfile.module, 'carburetor');
    const moduleRun = shop.wait(m => m.type === 'start'); shop.send({ type: 'pve', resume: false }); const equipped = (await moduleRun).battle;
    assert.equal(equipped.planes[0].boostDuration, 3); assert.equal(equipped.planes[0].boostRecharge, 7.5);
    const modMenu = shop.wait(m => m.type === 'profile'); shop.send({ type: 'leave' }); await modMenu;
    // Inject a disk failure inside the freshly created test directory.
    const storeFile = join(dir, 'profiles.json'); assert.ok(resolve(storeFile).startsWith(resolve(dir)));
    await rename(storeFile, storeFile + '.backup'); await mkdir(storeFile);
    const failedSpend = shop.wait(m => m.type === 'error'); const retryNonce = randomUUID(); shop.send({ type: 'exchange', nonce: retryNonce, amount: 10, currency: 'xp' });
    assert.match((await failedSpend).message, /Не удалось сохранить/);
    await rmdir(storeFile); await rename(storeFile + '.backup', storeFile);
    const retriedSpend = shop.wait(m => m.type === 'profile'); shop.send({ type: 'exchange', nonce: retryNonce, amount: 10, currency: 'xp' }); assert.equal((await retriedSpend).profile.gold, 120);
    const oldReward = shop.wait(m => m.type === 'profile'); shop.send({ type: 'claim', period: 'daily', id: 'activity', key: pastTaskKey });
    assert.equal((await oldReward).profile.silver, 5750);
    shop.send({ type: 'claim', period: 'daily', id: 'activity', key: pastTaskKey });
    const afterDuplicate = shop.wait(m => m.type === 'profile'); shop.send({ type: 'leave' }); assert.equal((await afterDuplicate).profile.silver, 5750);
    const a = new Peer(), b = new Peer(); peers.push(a, b); await Promise.all([a.open(), b.open()]);
    const account = await a.auth(); await b.auth();
    // Duplicate claims and arbitrary client wallet messages must never mint gold.
    const gift = a.wait(m => m.type === 'profile'); a.send({ type: 'login' }); const afterGift = (await gift).profile;
    assert.equal(afterGift.silver, 300); assert.equal(afterGift.xp, 20); assert.equal(afterGift.gold, 0);
    a.send({ type: 'login' }); a.send({ type: 'wallet', gold: 100000, silver: 100000 });
    const pve = a.wait(m => m.type === 'start'); a.send({ type: 'pve' }); const run = (await pve).battle;
    const paused = a.wait(m => m.type === 'state' && m.battle.paused); a.send({ type: 'pause', paused: true }); const checkpoint = (await paused).battle;
    const menu = a.wait(m => m.type === 'profile'); a.send({ type: 'leave' }); assert.equal((await menu).profile.silver, 300);
    const continued = a.wait(m => m.type === 'start'); a.send({ type: 'pve', resume: true }); const restored = (await continued).battle;
    assert.equal(restored.id, run.id); assert.equal(restored.distance, checkpoint.distance);
    const menu2 = a.wait(m => m.type === 'profile'); a.send({ type: 'leave' }); await menu2;
    const aStart = a.wait(m => m.type === 'start'), bStart = b.wait(m => m.type === 'start'); a.send({ type: 'queue' }); b.send({ type: 'queue' });
    const [one, two] = await Promise.all([aStart, bStart]); assert.equal(one.battle.id, two.battle.id); assert.ok(one.battle.planes.every((p: any) => !p.bot));
    const update = a.wait(m => m.type === 'state'); a.send({ type: 'input', turn: 1, fire: true, boost: true }); const state = (await update).battle;
    assert.equal(state.id, one.battle.id); assert.ok(state.time > 0);
    a.send({ type: 'leave' }); b.send({ type: 'leave' }); await sleep(100);
    const aReauth = new Peer(); peers.push(aReauth); await aReauth.open(); const sameAccount = await aReauth.auth(account.welcome.token);
    assert.equal(sameAccount.profile.id, account.profile.id); assert.equal(sameAccount.profile.gold, 0); assert.equal(sameAccount.profile.silver, 300);
    // Bot disabled: elapsed 15 seconds is not permission to launch an AI.
    aReauth.send({ type: 'bots', allowed: false }); const queued = aReauth.wait(m => m.type === 'queued'); aReauth.send({ type: 'queue' }); await queued;
    await assert.rejects(aReauth.rpc('payment-order', { sku: 'gold100' }), /вернитесь в ангар/);
    const priorStarts = aReauth.messages.filter(m => m.type === 'start').length;
    await sleep(15500); assert.equal(aReauth.messages.filter(m => m.type === 'start').length, priorStarts);
    const fallback = aReauth.wait(m => m.type === 'start'); aReauth.send({ type: 'bots', allowed: true }); const bot = (await fallback).battle;
    assert.ok(bot.planes.some((p: any) => p.bot));
    aReauth.send({ type: 'leave' }); await sleep(80);
    const q2 = aReauth.wait(m => m.type === 'queued'); aReauth.send({ type: 'queue' }); await q2;
    const cancelled = aReauth.wait(m => m.type === 'cancelled'); aReauth.send({ type: 'cancel' }); await cancelled;
    const starts = aReauth.messages.filter(m => m.type === 'start').length;
    await sleep(500); assert.equal(aReauth.messages.filter(m => m.type === 'start').length, starts);
  } finally {
    for (const p of peers) p.ws.close(); proc.kill();
    await new Promise<void>(r => { if (proc.exitCode !== null) r(); else { proc.once('exit', () => r()); setTimeout(r, 3000).unref(); } });
    // Only this freshly allocated test directory is removed.
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\') || resolve(dir).startsWith(resolve(tmpdir()) + '/'));
    await rm(dir, { recursive: true, force: true });
  }
});
