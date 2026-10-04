import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { PREMIUM_DURATION_MS, PREMIUM_PRODUCT_ID, hasPremium } from '../shared/premium';
import { bossBalance, campaignReward, ZONE, freshProfile, planeStats } from '../shared/data';
import { createBattle, makePlane, beginBoss } from '../shared/simulation';

const port = 5199, secret = 'premium-websocket-test-only';
function proof(data: unknown, now = Date.now()) {
  const bytes = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: Math.floor(now / 1000), data }));
  return createHmac('sha256', secret).update(bytes).digest('base64') + '.' + bytes.toString('base64');
}
class PremiumPeer {
  ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
  messages: any[] = [];
  waiters: { predicate: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  constructor() {
    this.ws.on('message', raw => {
      const m = JSON.parse(String(raw)); this.messages.push(m);
      for (const waiter of [...this.waiters]) if (waiter.predicate(m)) { this.waiters.splice(this.waiters.indexOf(waiter), 1); waiter.resolve(m); }
    });
  }
  open() { return new Promise<void>((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); }); }
  wait(predicate: (m: any) => boolean) {
    return new Promise<any>((resolve, reject) => {
      const waiter = { predicate, resolve: (m: any) => { clearTimeout(timer); resolve(m); } };
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(w => w !== waiter); reject(new Error('Истекло ожидание premium-сервера')); }, 5000);
      this.waiters.push(waiter);
    });
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  last(type: string) { return this.messages.filter(m => m.type === type).at(-1); }
  async call(type: string, data: object = {}) {
    const requestId = randomUUID(), result = this.wait(m => m.type === 'reply' && m.requestId === requestId);
    this.send({ type, requestId, ...data }); const reply = await result;
    if (!reply.ok) throw new Error(reply.error); return reply.result;
  }
  async auth(token?: string, extra: object = {}) {
    const welcome = this.wait(m => m.type === 'welcome'), profile = this.wait(m => m.type === 'profile');
    this.send({ type: 'auth', token, ...extra }); return { welcome: await welcome, state: await profile };
  }
  async refresh() { const state = this.wait(m => m.type === 'profile'); this.send({ type: 'refresh' }); return (await state).profile; }
}
class PremiumServer {
  proc?: ChildProcess; peers: PremiumPeer[] = [];
  constructor(readonly dir: string, readonly store: string) {}
  async start(mode = 'production', debug = true, now?: number) {
    let entry = 'server/index.ts';
    if (now !== undefined) {
      entry = join(this.dir,'clock.mjs');
      await writeFile(entry, `let clock=${now};Date.now=()=>clock;process.on('message',m=>{if(m.type==='clock'){clock=m.now;process.send({id:m.id});}});await import(${JSON.stringify(pathToFileURL(resolve('server/index.ts')).href)});`);
    }
    const proc = this.proc = spawn(process.execPath, ['--import', 'tsx', entry], {
      cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: mode, BIPLANES_DEBUG: debug ? '1' : '0', BIPLANES_DATA: this.store, YANDEX_PAYMENT_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let errors = '';
    proc.stderr!.on('data', data => errors += String(data));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Premium server startup timeout: ' + errors)), 6000);
      proc.stdout!.on('data', data => { if (String(data).includes('Сервер Бипланы')) { clearTimeout(timer); resolve(); } });
      proc.once('error', error => { clearTimeout(timer); reject(error); });
      proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Premium server exit ${code}: ${errors}`)); });
    });
  }
  async setClock(now:number) {
    const id=randomUUID(), proc=this.proc!;
    await new Promise<void>((resolve,reject)=>{
      const listener=(m:any)=>{if(m.id===id){clearTimeout(timer);proc.off('message',listener);resolve();}};
      const timer=setTimeout(()=>{proc.off('message',listener);reject(new Error('Clock ACK timeout'));},5000);
      proc.on('message',listener);proc.send({type:'clock',now,id});
    });
  }
  async connect() { const peer = new PremiumPeer(); this.peers.push(peer); await peer.open(); return peer; }
  async stop() {
    for (const peer of this.peers) peer.ws.close(); this.peers = [];
    const proc = this.proc; this.proc = undefined;
    if (!proc || proc.exitCode !== null) return;
    proc.kill(); await new Promise<void>(resolve => { proc.once('exit', () => resolve()); setTimeout(resolve, 3000).unref(); });
  }
  async cleanup() {
    await this.stop(); const path = relative(resolve(tmpdir()), resolve(this.dir));
    assert.ok(path && !path.startsWith('..') && !isAbsolute(path));
    await rm(this.dir, { recursive: true, force: true });
  }
}
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'biplanes-premium-test-')); return new PremiumServer(dir, join(dir, 'profiles.json')); }

test('Server keeps active premium at the boss after a third loss; free/expired accounts reset and cannot forge unlimited attempts', {timeout:15000}, async()=>{
  const server=await fixture(), now=Date.now();
  const accounts=['active','free','expired'].map(kind=>{
    const profile=freshProfile('boss-'+kind);
    if(kind!=='free')profile.premium={active:true,purchasedAt:now-1000,expiresAt:kind==='active'?now+60000:now};
    const checkpoint=createBattle('third-loss-'+kind,'pve',[makePlane(profile.id,planeStats(profile,true))],10);
    beginBoss(checkpoint);checkpoint.planes[0].health=0;
    return{token:'boss-token-'+kind,profile,checkpoint,restartLevel:10,restartBoss:true,bossFailures:{level:10,count:2},campaignLength:250};
  });
  await writeFile(server.store,JSON.stringify(accounts));
  try{
    await server.start();
    for(const kind of ['active','free','expired']){
      const peer=await server.connect();await peer.auth('boss-token-'+kind);
      const start=peer.wait(m=>m.type==='start');peer.send({type:'pve',resume:true});
      assert.equal((await start).battle.bossAttemptsUnlimited,kind==='active');
      const end=peer.wait(m=>m.type==='state'&&m.battle.phase==='ended');
      const profile=peer.wait(m=>m.type==='profile');
      peer.send({type:'boss-start',bossAttemptsUnlimited:true});
      const loss=(await end).battle,state=await profile;
      assert.equal(loss.bossAttemptsExhausted,kind==='active'?undefined:true);
      assert.equal(state.restartLevel,kind==='active'?10:1);
    }
    // Allow the server's normal checkpoint writer to persist the actual outcomes.
    await new Promise(resolve=>setTimeout(resolve,650));
    const saved=JSON.parse(await readFile(server.store,'utf8'));
    for(const kind of ['active','free','expired']){
      const a=saved.find((a:any)=>a.token==='boss-token-'+kind);
      assert.equal(a.restartLevel,kind==='active'?10:1);
      assert.equal(a.restartBoss,kind==='active');
    }
  }finally{await server.cleanup();}
});

test('Сервер премиума: подписанная покупка, disk ACK, перезапуск, восстановление, защита аккаунта', { timeout: 22000 }, async () => {
  const server = await fixture();
  try {
    await server.start(); const a = await server.connect(), b = await server.connect();
    const first = await a.auth(), second = await b.auth();
    assert.equal(first.welcome.paymentsEnabled, true); assert.equal(first.welcome.debugEnabled, false);
    const order = await a.call('payment-order', { sku: PREMIUM_PRODUCT_ID });
    const purchase = { productID: PREMIUM_PRODUCT_ID, purchaseToken: 'server-premium-receipt-1', developerPayload: order.id };
    assert.deepEqual(await a.call('payment-redeem', { signature: proof([purchase]) }), { consume: [purchase.purchaseToken], pending: [] });
    const stored = JSON.parse(await readFile(server.store, 'utf8')).find((x: any) => x.token === first.welcome.token);
    assert.equal(stored.profile.premium.active, true); assert.ok(stored.profile.premium.purchasedAt > 0);
    assert.equal(stored.profile.gold, 0); assert.equal(stored.profile.silver, 200); assert.equal(stored.profile.xp, 0);
    assert.equal(Object.keys(stored.receipts).length, 1);
    const purchasedAt = stored.profile.premium.purchasedAt;
    assert.equal(stored.profile.premium.expiresAt,purchasedAt+PREMIUM_DURATION_MS);
    const extensionOrder=await a.call('payment-order', { sku: PREMIUM_PRODUCT_ID });
    const extension={...purchase,purchaseToken:'server-premium-extension',developerPayload:extensionOrder.id};
    assert.deepEqual(await a.call('payment-redeem',{signature:proof([extension,extension])}),{consume:[extension.purchaseToken],pending:[]});
    const expiresAt=purchasedAt+2*PREMIUM_DURATION_MS;
    assert.equal(a.last('profile').profile.premium.expiresAt,expiresAt);
    assert.deepEqual(await a.call('payment-redeem', { signature: proof([purchase, purchase]) }), { consume: [purchase.purchaseToken], pending: [] });
    assert.equal(a.last('profile').profile.premium.purchasedAt, purchasedAt);
    assert.equal(a.last('profile').profile.premium.expiresAt, expiresAt);
    await assert.rejects(b.call('payment-redeem', { signature: proof([purchase]) }), /другому ангару/);
    assert.equal((await b.refresh()).premium, undefined);
    const unknown = { ...purchase, purchaseToken: 'unbound-premium', developerPayload: 'unbound-order' };
    assert.deepEqual(await b.call('payment-redeem', { signature: proof([unknown]) }), { consume: [], pending: [PREMIUM_PRODUCT_ID] });
    assert.equal(b.last('profile').profile.premium, undefined);
    const signature = proof([unknown]), forged = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    await assert.rejects(b.call('payment-redeem', { signature: forged }), /подпи|подтверждена/);
    await assert.rejects(b.call('payment-order', { sku: 'premium-free' }), /не подключены/);
    await assert.rejects(b.call('debug', { action: 'premium', amount: 1 }), /отключена/);
    const run = a.wait(m => m.type === 'start'); a.send({ type: 'pve' });
    assert.equal((await run).battle.planes[0].rewardMultiplier, 1.5);
    const left = a.wait(m => m.type === 'profile'); a.send({ type: 'leave' }); await left;
    // Consumed purchases disappear from getPurchases(); owned server receipts
    // still restore the recorded extended term after a real restart.
    await server.stop();
    const accounts = JSON.parse(await readFile(server.store, 'utf8'));
    delete accounts.find((x: any) => x.token === first.welcome.token).profile.premium;
    await writeFile(server.store, JSON.stringify(accounts)); await server.start();
    const restored = await server.connect(), unauthorized = await server.connect();
    assert.equal((await restored.auth(first.welcome.token)).state.profile.premium, undefined);
    assert.deepEqual(await restored.call('payment-redeem', { signature: proof([]) }), { consume: [], pending: [] });
    assert.deepEqual(restored.last('profile').profile.premium, { active: true, purchasedAt, expiresAt });
    assert.deepEqual(await restored.call('payment-redeem',{signature:proof([purchase])}),{consume:[purchase.purchaseToken],pending:[]});
    assert.equal(restored.last('profile').profile.premium.expiresAt,expiresAt);
    const persisted = JSON.parse(await readFile(server.store, 'utf8')).find((x: any) => x.token === first.welcome.token);
    assert.equal(persisted.profile.premium.purchasedAt, purchasedAt); assert.equal(persisted.profile.gold, 0);
    await unauthorized.auth(second.welcome.token); await assert.rejects(unauthorized.call('payment-redeem', { signature: proof([purchase]) }), /другому ангару/);
    assert.equal((await unauthorized.refresh()).premium, undefined);
  } finally { await server.cleanup(); }
});

test('Сервер не подтверждает премиум при отказе диска; повторный чек выдаёт ровно один доступ', { timeout: 12000 }, async () => {
  const server = await fixture();
  try {
    await server.start(); const peer = await server.connect(); const auth = await peer.auth();
    const order = await peer.call('payment-order', { sku: PREMIUM_PRODUCT_ID });
    const purchase = { productID: PREMIUM_PRODUCT_ID, purchaseToken: 'premium-disk-retry', developerPayload: order.id };
    // Restrict the failure injection to this test's newly allocated directory.
    assert.equal(resolve(server.store), resolve(join(server.dir, 'profiles.json')));
    await rename(server.store, server.store + '.backup'); await mkdir(server.store);
    await assert.rejects(peer.call('payment-redeem', { signature: proof([purchase]) }), /Не удалось сохранить/);
    assert.equal((await peer.refresh()).premium, undefined);
    await rmdir(server.store); await rename(server.store + '.backup', server.store);
    assert.deepEqual(await peer.call('payment-redeem', { signature: proof([purchase]) }), { consume: [purchase.purchaseToken], pending: [] });
    const stored = JSON.parse(await readFile(server.store, 'utf8')).find((x: any) => x.token === auth.welcome.token);
    assert.equal(stored.profile.premium.active, true); assert.equal(Object.keys(stored.receipts).length, 1);
    await peer.call('payment-redeem', { signature: proof([purchase]) }); assert.equal(peer.last('profile').profile.gold, 0);
    const expiry=stored.profile.premium.expiresAt, extensionOrder=await peer.call('payment-order',{sku:PREMIUM_PRODUCT_ID});
    const extension={...purchase,purchaseToken:'premium-extension-disk-retry',developerPayload:extensionOrder.id};
    await rename(server.store,server.store+'.backup');await mkdir(server.store);
    await assert.rejects(peer.call('payment-redeem',{signature:proof([extension])}),/Не удалось сохранить/);
    assert.equal((await peer.refresh()).premium.expiresAt,expiry);
    await rmdir(server.store);await rename(server.store+'.backup',server.store);
    assert.deepEqual(await peer.call('payment-redeem',{signature:proof([extension,extension])}),{consume:[extension.purchaseToken],pending:[]});
    assert.equal(peer.last('profile').profile.premium.expiresAt,expiry+PREMIUM_DURATION_MS);
    await peer.call('payment-redeem',{signature:proof([purchase,extension])});assert.equal(peer.last('profile').profile.premium.expiresAt,expiry+PREMIUM_DURATION_MS);
  } finally { await server.cleanup(); }
});

test('Debug и произвольные клиентские поля не могут выдать оплаченный премиум', { timeout: 10000 }, async () => {
  const server = await fixture();
  try {
    await server.start('test'); const peer = await server.connect();
    const injected = { premium: { active: true, purchasedAt: Date.now() }, rewardMultiplier: 1.5 };
    const auth = await peer.auth(undefined, { profile: injected, ...injected });
    assert.equal(auth.welcome.debugEnabled, true); assert.equal(auth.state.profile.premium, undefined);
    await assert.rejects(peer.call('debug', { action: 'premium', amount: 1 }));
    await peer.call('debug', { action: 'gold', amount: 1000 });
    peer.send({ type: 'wallet', ...injected }); peer.send({ type: 'premium', active: true });
    const state = await peer.refresh(); assert.equal(state.premium, undefined); assert.equal(state.gold, 1000);
    const run = peer.wait(m => m.type === 'start'); peer.send({ type: 'pve', ...injected });
    assert.equal((await run).battle.planes[0].rewardMultiplier, 1);
  } finally { await server.cleanup(); }
});

test('30-дневный срок истекает в активном бою ровно на границе, не восстанавливается при reconnect и продлевается новой оплатой', {timeout:18000}, async()=>{
  const server=await fixture(), start=1770000000000;
  try {
    await server.start('test',true,start);const peer=await server.connect(), auth=await peer.auth();
    const order=await peer.call('payment-order',{sku:PREMIUM_PRODUCT_ID});
    const purchase={productID:PREMIUM_PRODUCT_ID,purchaseToken:'expiry-in-flight',developerPayload:order.id};
    await peer.call('payment-redeem',{signature:proof([purchase],start)});
    const expiresAt=start+PREMIUM_DURATION_MS;assert.equal(peer.last('profile').profile.premium.expiresAt,expiresAt);
    const launching=peer.wait(m=>m.type==='start');peer.send({type:'pve'});const first=(await launching).battle;
    assert.equal(first.planes[0].rewardMultiplier,1.5);
    const active=peer.wait(m=>m.type==='state'&&m.battle.id===first.id&&m.battle.planes[0].rewardMultiplier===1.5);
    await server.setClock(expiresAt-1);await active;
    const expired=peer.wait(m=>m.type==='state'&&m.battle.id===first.id&&m.battle.planes[0].rewardMultiplier===1);
    await server.setClock(expiresAt);const expiredState=(await expired).battle;
    assert.deepEqual(expiredState.earned[first.planes[0].id],first.earned[first.planes[0].id]);
    const leaving=peer.wait(m=>m.type==='profile');peer.send({type:'leave'});await leaving;
    await server.stop();await server.start('test',true,expiresAt);
    const restored=await server.connect(), reconnect=await restored.auth(auth.welcome.token);
    assert.equal(hasPremium(reconnect.state.profile,expiresAt),false);assert.equal(reconnect.state.profile.premium.expiresAt,expiresAt);
    await restored.call('payment-redeem',{signature:proof([purchase],expiresAt)});
    assert.equal(restored.last('profile').profile.premium.expiresAt,expiresAt);
    const resuming=restored.wait(m=>m.type==='start');restored.send({type:'pve',resume:true});
    assert.equal((await resuming).battle.planes[0].rewardMultiplier,1);
    for(let n=0;n<9;n++)await restored.call('debug',{action:'next-level',paused:true});
    const before=await restored.refresh();await restored.call('debug',{action:'win-boss',paused:true});const after=restored.last('profile').profile;
    assert.equal(after.silver-before.silver,campaignReward(bossBalance(10).silver)+campaignReward(ZONE[9].rewardSilver));
    assert.equal(after.xp-before.xp,campaignReward(bossBalance(10).xp)+campaignReward(ZONE[9].rewardXp));
    const left=restored.wait(m=>m.type==='profile');restored.send({type:'leave'});await left;
    const renewalOrder=await restored.call('payment-order',{sku:PREMIUM_PRODUCT_ID});
    const renewal={...purchase,purchaseToken:'expiry-renewed',developerPayload:renewalOrder.id};
    await restored.call('payment-redeem',{signature:proof([renewal],expiresAt)});
    assert.equal(restored.last('profile').profile.premium.expiresAt,expiresAt+PREMIUM_DURATION_MS);
    assert.equal(hasPremium(restored.last('profile').profile,expiresAt),true);
  } finally {await server.cleanup();}
});
