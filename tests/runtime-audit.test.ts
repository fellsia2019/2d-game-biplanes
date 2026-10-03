import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { freshProfile, planeStats, PLANES, type Profile } from '../shared/data';
import { approachBoss, createBattle, makePlane } from '../shared/simulation';

const PORT = 5200, SECRET = 'runtime-audit-only-secret';
type Signal = { type: string; [key: string]: any };
class AuditPeer {
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/socket`);
  messages: any[] = [];
  waiters: Array<{ predicate: (m: any) => boolean; resolve: (m: any) => void }> = [];
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
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(w => w !== waiter); reject(new Error('Runtime audit message timeout')); }, 5000);
      this.waiters.push(waiter);
    });
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  last(type: string) { return this.messages.filter(m => m.type === type).at(-1); }
  async auth(token = 'runtime-audit-token') {
    const welcome = this.wait(m => m.type === 'welcome'), state = this.wait(m => m.type === 'profile');
    this.send({ type: 'auth', token }); return { welcome: await welcome, state: await state };
  }
  async call(type: string, extra: object = {}) {
    const requestId = randomUUID(), response = this.wait(m => m.type === 'reply' && m.requestId === requestId);
    this.send({ type, requestId, ...extra }); const reply = await response;
    if (!reply.ok) throw new Error(reply.error); return reply.result;
  }
  async message(type: string, extra: object = {}, target = 'profile') {
    const response = this.wait(m => m.type === target); this.send({ type, ...extra }); return await response;
  }
}
class AuditServer {
  proc?: ChildProcess; peers: AuditPeer[] = []; signals: Signal[] = [];
  waits: Array<{ predicate: (m: Signal) => boolean; resolve: (m: Signal) => void }> = [];
  store: string; marker: string;
  constructor(readonly dir: string) { this.store = join(dir, 'profiles.json'); this.marker = join(dir, 'fault-marker'); }
  signal(predicate: (m: Signal) => boolean) {
    const seen = this.signals.find(predicate); if (seen) return Promise.resolve(seen);
    return new Promise<Signal>((resolve, reject) => {
      const waiter = { predicate, resolve: (m: Signal) => { clearTimeout(timer); resolve(m); } };
      const timer = setTimeout(() => { this.waits = this.waits.filter(w => w !== waiter); reject(new Error('Runtime audit IPC timeout')); }, 5000);
      this.waits.push(waiter);
    });
  }
  async start(setup?: (profile: Profile) => void) {
    const profile = freshProfile('runtime-audit-pilot'); profile.owned = PLANES.map(p => p.id);
    profile.silver = 50000; profile.gold = 2000; profile.xp = 5000;
    profile.defeatedBosses = [10]; profile.modifierBosses = [10]; profile.modifiers = [{ id: 'reinforced-hull', level: 1 }];
    setup?.(profile);
    const battle = createBattle('runtime-audit-boss', 'pve', [makePlane(profile.id, planeStats(profile, true))], 25);
    approachBoss(battle); battle.planes[0].health = battle.planes[0].hp / 2; battle.planes[1].health /= 2;
    await writeFile(this.store, JSON.stringify([{ token: 'runtime-audit-token', profile, checkpoint: battle, restartLevel: 25, restartBoss: true, campaignLength: 250 }]));
    const root = process.cwd(), boot = join(this.dir, 'boot.mjs');
    // Instrument only this child process. An IPC gate controls persistence;
    // observers record when auth/profile output is emitted, without sleeps.
    await writeFile(boot, `
      import {existsSync} from 'node:fs';
      import {createRequire} from 'node:module';
      const require = createRequire(${JSON.stringify(join(root, 'package.json'))});
      const {WebSocketServer} = require('ws');
      const {AtomicStore} = await import(${JSON.stringify(pathToFileURL(join(root, 'server/storage.ts')).href)});
      const write = AtomicStore.prototype.write, emit = WebSocketServer.prototype.emit;
      let gate, gateHeld = false, armed = false, serial = 0; const sockets = [];
      AtomicStore.prototype.write = function() {
        if (!armed || !existsSync(${JSON.stringify(this.marker)})) return write.call(this);
        armed = false;
        gateHeld = true; process.send({type:'write-entered'});
        return new Promise((resolve, reject) => { gate = {resolve, reject, store:this}; });
      };
      WebSocketServer.prototype.emit = function(event, ...args) {
        if (event === 'connection') {
          const socket = args[0], connection = ++serial, send = socket.send; sockets.push(socket);
          socket.send = function(payload, ...options) {
            const message = JSON.parse(String(payload));
            if (message.type === 'profile') process.send({type:'profile-emitted',connection,gateHeld,modifiers:(message.profile.modifiers ?? []).length});
            return send.call(this,payload,...options);
          };
          socket.on('message', payload => {
            const message = JSON.parse(String(payload));
            if (message.auditHoldWrite === true) armed = true;
            if (message.type === 'auth') process.send({type:'auth-seen',connection});
            if (message.auditMarker) process.send({type:'command-seen',connection,marker:message.auditMarker});
          });
        }
        return emit.call(this,event,...args);
      };
      process.on('message', message => {
        if (message.type === 'release') setImmediate(() => {
          const current = gate; gate = undefined; gateHeld = false;
          if (!current) return;
          if (message.fail) current.reject(Object.assign(new Error('controlled audit disk failure'),{code:'EIO'}));
          else write.call(current.store).then(current.resolve,current.reject);
        });
        if (message.type === 'socket-snapshot') process.send({type:'socket-snapshot',states:sockets.map(socket=>socket.readyState)});
      });
      await import(${JSON.stringify(pathToFileURL(join(root, 'server/index.ts')).href)});
    `);
    const proc = this.proc = spawn(process.execPath, ['--import', 'tsx', boot], {
      cwd: root, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'test', BIPLANES_DEBUG: '1', BIPLANES_DATA: this.store, YANDEX_PAYMENT_SECRET: SECRET }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    proc.on('message', m => {
      const signal = m as Signal; this.signals.push(signal);
      for (const waiter of [...this.waits]) if (waiter.predicate(signal)) { this.waits.splice(this.waits.indexOf(waiter), 1); waiter.resolve(signal); }
    });
    let errors = '';
    proc.stderr!.on('data', raw => errors += String(raw));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Runtime audit server timeout: ' + errors)), 6000);
      proc.stdout!.on('data', raw => { if (String(raw).includes('Сервер Бипланы')) { clearTimeout(timer); resolve(); } });
      proc.once('error', error => { clearTimeout(timer); reject(error); });
      proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Runtime audit server exit ${code}: ${errors}`)); });
    });
  }
  async connect() { const peer = new AuditPeer(); this.peers.push(peer); await peer.open(); return peer; }
  async holdWrite() { await writeFile(this.marker, 'controlled gate'); }
  async releaseWrite(fail: boolean) { await rm(this.marker); this.proc!.send({ type: 'release', fail }); }
  async snapshotSockets() {
    this.signals = this.signals.filter(m => m.type !== 'socket-snapshot');
    const response = this.signal(m => m.type === 'socket-snapshot'); this.proc!.send({ type: 'socket-snapshot' }); return (await response).states as number[];
  }
  async cleanup() {
    for (const peer of this.peers) peer.ws.terminate();
    const proc = this.proc;
    if (proc && proc.exitCode === null) {
      if (proc.connected) proc.send({ type: 'release', fail: true });
      proc.kill(); await new Promise<void>(resolve => { proc.once('exit', () => resolve()); setTimeout(resolve, 3000).unref(); });
    }
    const path = relative(resolve(tmpdir()), resolve(this.dir)); assert.ok(path && !path.startsWith('..') && !isAbsolute(path));
    await rm(this.dir, { recursive: true, force: true });
  }
}
async function fixture(setup?: (profile: Profile) => void) {
  const server = new AuditServer(await mkdtemp(join(tmpdir(), 'biplanes-runtime-audit-test-')));
  try { await server.start(setup); return server; } catch (error) { await server.cleanup(); throw error; }
}

test('Новый auth ждёт сохранения карточки; отказ диска не публикует временный модификатор', { timeout: 15000 }, async () => {
  const server = await fixture();
  try {
    const first = await server.connect(); await first.auth(); await first.message('pve', { resume: true }, 'start');
    await first.call('debug', { action: 'win-boss' }); const offer = first.last('profile').bossOffer;
    await server.holdWrite(); first.send({ type: 'modifier-choose', offerId: offer.id, id: offer.options[0], paused: true, requestId: randomUUID(), auditHoldWrite: true });
    await server.signal(m => m.type === 'write-entered');
    const second = await server.connect(), reopened = second.auth();
    await server.signal(m => m.type === 'auth-seen' && m.connection === 2); await server.releaseWrite(true);
    const recovered = await reopened;
    assert.equal(recovered.state.profile.modifiers.length, 1, 'Uncommitted choice must never reach the next window');
    assert.deepEqual(recovered.state.bossOffer, offer);
    const publication = await server.signal(m => m.type === 'profile-emitted' && m.connection === 2);
    assert.equal(publication.gateHeld, false);
    const blocked = await second.message('pve', { resume: true });
    assert.deepEqual(blocked.bossOffer, offer); assert.equal(second.last('start'), undefined);
    await second.call('modifier-choose', { offerId: offer.id, id: offer.options[0], paused: true });
    const persisted = JSON.parse(await readFile(server.store, 'utf8'))[0];
    assert.equal(persisted.profile.modifiers.length, 2); assert.equal(persisted.profile.modifiers[1].id, offer.options[0]);
    const resumed = (await second.message('pve', { resume: true }, 'start')).battle;
    assert.equal(resumed.level, 26); assert.deepEqual(resumed.planes[0].traits, planeStats(persisted.profile, true).traits);
  } finally { await server.cleanup(); }
});

test('Повторный вход закрывает каждую прежнюю сессию, включая старую с задержанным close', { timeout: 12000 }, async () => {
  const server = await fixture();
  try {
    const first = await server.connect(); await first.auth();
    // Stop only the test client's automatic close ACK, modeling network delay.
    (first.ws as any)._receiver.removeAllListeners('conclude');
    const second = await server.connect(); await second.auth();
    const third = await server.connect(); await third.auth();
    const states = await server.snapshotSockets();
    assert.equal(states.filter(state => state === WebSocket.OPEN).length, 1);
    assert.equal(states[2], WebSocket.OPEN); assert.notEqual(states[1], WebSocket.OPEN);
    assert.equal((await third.message('refresh')).profile.id, 'runtime-audit-pilot');
  } finally { await server.cleanup(); }
});

test('Финансовая команда, вставшая после нового auth, не исполняется в закрытой старой сессии', { timeout: 15000 }, async () => {
  const server = await fixture(profile => { profile.research = { universal: { hull: 1, engine: 0, gun: 0 } }; });
  let stage = 'initial authentication';
  try {
    const first = await server.connect(); await first.auth();
    const unrelated = await server.connect(); await unrelated.auth('unrelated-audit-account');
    await server.holdWrite(); unrelated.send({ type: 'debug', action: 'gold', amount: 1, requestId: randomUUID(), auditHoldWrite: true });
    stage = 'holding unrelated financial write';
    await server.signal(m => m.type === 'write-entered');
    const second = await server.connect(), reopened = second.auth();
    stage = 'observing queued authentication';
    await server.signal(m => m.type === 'auth-seen' && m.connection === 3);
    const nonce = randomUUID();
    first.send({ type: 'upgrade', branch: 'hull', level: 1, nonce, auditMarker: 'stale-upgrade' });
    stage = 'observing stale upgrade';
    await server.signal(m => m.type === 'command-seen' && m.marker === 'stale-upgrade');
    await server.releaseWrite(false); stage = 'completing new authentication'; await reopened;
    // A new-session financial ACK drains the queue behind the stale command.
    stage = 'draining financial queue'; await second.call('payment-order', { sku: 'gold100' });
    const profile = second.last('profile').profile;
    assert.equal(profile.upgrades.universal?.hull ?? 0, 0); assert.equal(profile.silver, 50000);
    const persisted = JSON.parse(await readFile(server.store, 'utf8')).find((a: any) => a.token === 'runtime-audit-token');
    assert.equal(persisted.operations?.[nonce], undefined);
    stage = 'resuming unchanged boss'; const resumed = (await second.message('pve', { resume: true }, 'start')).battle;
    assert.equal(resumed.planes[0].hp, 120); assert.equal(resumed.planes[0].health, 60);
  } catch (error) { throw new Error(stage + ': ' + (error instanceof Error ? error.message : String(error))); }
  finally { await server.cleanup(); }
});

test('Разрыв связи во время сохранения выбора сохраняет победу и выдаёт карточку ровно один раз', { timeout: 15000 }, async () => {
  const server = await fixture();
  try {
    const first = await server.connect(); await first.auth(); await first.message('pve', { resume: true }, 'start');
    await first.call('debug', { action: 'win-boss' });
    const before = first.last('profile').profile, offer = first.last('profile').bossOffer;
    await server.holdWrite(); first.send({ type: 'modifier-choose', offerId: offer.id, id: offer.options[0], paused: true, requestId: randomUUID(), auditHoldWrite: true });
    await server.signal(m => m.type === 'write-entered'); first.ws.terminate();
    const second = await server.connect(), reopened = second.auth();
    await server.signal(m => m.type === 'auth-seen' && m.connection === 2); await server.releaseWrite(false);
    const recovered = await reopened;
    assert.equal(recovered.state.profile.modifiers.length, 2); assert.equal(recovered.state.bossOffer, undefined);
    assert.equal((await server.signal(m => m.type === 'profile-emitted' && m.connection === 2)).gateHeld, false);
    assert.equal(recovered.state.profile.silver, before.silver); assert.equal(recovered.state.profile.xp, before.xp);
    const persisted = JSON.parse(await readFile(server.store, 'utf8'))[0];
    assert.equal(persisted.profile.modifiers[1].id, offer.options[0]);
    const resumed = (await second.message('pve', { resume: true }, 'start')).battle;
    assert.equal(resumed.level, 26); assert.equal(resumed.phase, 'flight');
    assert.deepEqual(resumed.planes[0].traits, planeStats(persisted.profile, true).traits);
    await second.message('leave');
    await second.call('modifier-choose', { offerId: offer.id, id: offer.options[0] });
    const repeated = second.last('profile').profile;
    assert.equal(repeated.modifiers.length, 2); assert.equal(repeated.silver, before.silver); assert.equal(repeated.xp, before.xp);
  } finally { await server.cleanup(); }
});

test('Возврат к сохранённому боссу применяет любой самолёт, апгрейд, модуль и новый премиум', { timeout: 15000 }, async () => {
  const server = await fixture(p => {p.defeatedBosses=[10,25];p.modifierBosses=[10,25];});
  try {
    const peer = await server.connect(); await peer.auth();
    let start = (await peer.message('pve', { resume: true }, 'start')).battle;
    assert.equal(start.planes[0].rewardMultiplier, 1); await peer.message('leave');
    const order = await peer.call('payment-order', { sku: 'premium' });
    const purchase = { productID: 'premium', purchaseToken: 'runtime-audit-premium', developerPayload: order.id };
    const bytes = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issuedAt: Math.floor(Date.now() / 1000), data: [purchase] }));
    const signature = createHmac('sha256', SECRET).update(bytes).digest('base64') + '.' + bytes.toString('base64');
    assert.deepEqual(await peer.call('payment-redeem', { signature }), { consume: [purchase.purchaseToken], pending: [] });
    for (const model of PLANES) {
      await peer.message('select', { id: model.id });
      const withModule = (await peer.message('module-buy', { id: 'radiator', model:model.id, nonce: randomUUID() })).profile as Profile;
      let state:Profile;
      if (model.id === 'skate') {
        state=(await peer.message('phoenix-part',{branch:'hull',level:1,nonce:randomUUID()})).profile as Profile;
        assert.equal(state.gold,withModule.gold-30);assert.equal(state.silver,withModule.silver);assert.equal(state.xp,withModule.xp);assert.equal(state.phoenixParts?.hull,1);
      } else {
        await peer.message('research', { branch: 'hull', level: 1, nonce: randomUUID() });
        state = (await peer.message('upgrade', { branch: 'hull', level: 1, nonce: randomUUID() })).profile as Profile;
      }
      start = (await peer.message('pve', { resume: true }, 'start')).battle;
      const actual = start.planes[0], expected = planeStats(state, true);
      assert.equal(start.id, 'runtime-audit-boss'); assert.equal(start.phase, 'boss-intro'); assert.equal(start.bossAttempt, 1);
      assert.equal(actual.model, model.id); assert.equal(actual.hp, expected.hp); assert.equal(actual.damage, expected.damage);
      assert.equal(actual.cooling, 1.35); assert.equal(actual.rewardMultiplier, 1.5); assert.deepEqual(actual.traits, expected.traits);
      assert.ok(Math.abs(actual.health / actual.hp - .5) < 1e-9); assert.equal(start.planes[1].health / start.planes[1].hp, .5);
      await peer.message('leave');
    }
  } finally { await server.cleanup(); }
});
