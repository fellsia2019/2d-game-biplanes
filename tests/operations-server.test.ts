import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { freshProfile, planeStats, resetTasks, type Profile } from '../shared/data';
import { createBattle, makePlane, type Battle } from '../shared/simulation';
import { freshOperation, operationMission, SORTIE_REWARD } from '../shared/operations';
import { PHASE_SKILL } from '../shared/skills';

const PORT = 5201, TOKEN = 'operations-server-token';
type Signal = { type: string; [key: string]: any };
type Seed = { token: string; profile: Profile; checkpoint?: Battle; restartLevel?: number; campaignLength: number };

function seed(token = TOKEN, setup?: (profile: Profile) => void): Seed {
  const profile = freshProfile('pilot-' + token); profile.silver = 2400; profile.xp = profile.totalXp = 600;
  profile.defeatedBosses = [10]; profile.modifierBosses = [10]; profile.modifiers = []; resetTasks(profile);
  setup?.(profile); return { token, profile, campaignLength: 250 };
}
function sortieSeed(setup?: (profile: Profile) => void): Seed {
  const account = seed(TOKEN, setup), profile = account.profile;
  const checkpoint = createBattle('saved-operation-4', 'pve', [makePlane(profile.id, planeStats(profile, true))], 4);
  const previous = operationMission(4, 0);
  checkpoint.operation = { ...freshOperation(1), seconds: previous.seconds, kills: previous.targetKills, specialKills: previous.targetSpecial, collected: previous.targetPickups, killSilver:40, killXp:10 };
  checkpoint.phase = 'sortie-reward'; checkpoint.paused = true; checkpoint.planes[0].health = 40;
  checkpoint.planes[0].heat = .8; checkpoint.planes[0].energy = .2;
  checkpoint.earned[profile.id] = { silver: SORTIE_REWARD.silver / 2, xp: SORTIE_REWARD.xp / 2 };
  // This fixture represents an already credited sortie; continuing must not
  // credit it again, including after a disconnect during durable saving.
  profile.daily.activity = profile.daily.wins = profile.weekly.activity = 1;
  account.checkpoint = checkpoint; account.restartLevel = 4; return account;
}
const wallet = (profile: Profile) => ({ silver: profile.silver, xp: profile.xp, totalXp: profile.totalXp, gold: profile.gold });

class Peer {
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/socket`); messages: any[] = [];
  waits: Array<{ predicate: (m: any) => boolean; resolve: (m: any) => void }> = [];
  constructor() {
    this.ws.on('message', raw => {
      const m = JSON.parse(String(raw)); this.messages.push(m);
      for (const waiter of [...this.waits]) if (waiter.predicate(m)) { this.waits.splice(this.waits.indexOf(waiter), 1); waiter.resolve(m); }
    });
  }
  open() { return new Promise<void>((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); }); }
  wait(predicate: (m: any) => boolean) {
    return new Promise<any>((resolve, reject) => {
      const waiter = { predicate, resolve: (m: any) => { clearTimeout(timer); resolve(m); } };
      const timer = setTimeout(() => { this.waits = this.waits.filter(w => w !== waiter); reject(new Error('Operations server message timeout')); }, 5000);
      this.waits.push(waiter);
    });
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  async ready(battle: Battle) {
    const response = this.wait(m => m.type === 'state' && !m.battle.missionIntro);
    this.send({type:'mission-ready', key:battle.missionIntro, paused:false});
    return (await response).battle;
  }
  last(type: string) { return this.messages.filter(m => m.type === type).at(-1); }
  async auth(token = TOKEN) {
    const welcome = this.wait(m => m.type === 'welcome'), profile = this.wait(m => m.type === 'profile');
    this.send({ type: 'auth', token }); await welcome; return await profile;
  }
  async message(type: string, data: object = {}, target = 'profile') {
    const result = this.wait(m => m.type === target); this.send({ type, ...data }); return await result;
  }
  async spend(data: object) {
    // Shop mutations acknowledge through the durable profile message.
    const result = this.wait(m => m.type === 'profile' || m.type === 'error');
    this.send({ type: 'skill-buy', ...data }); const response = await result;
    if (response.type === 'error') throw new Error(response.message); return response.profile as Profile;
  }
  async rpc(type: string, data: object = {}) {
    const requestId = randomUUID(), result = this.wait(m => m.type === 'reply' && m.requestId === requestId);
    this.send({ type, requestId, ...data }); const reply = await result;
    if (!reply.ok) throw new Error(reply.error); return reply.result;
  }
}

class OperationServer {
  proc?: ChildProcess; peers: Peer[] = []; signals: Signal[] = [];
  waits: Array<{ predicate: (m: Signal) => boolean; resolve: (m: Signal) => void }> = [];
  constructor(readonly dir: string, readonly store: string, readonly boot: string) {}
  signal(predicate: (m: Signal) => boolean) {
    const previous = this.signals.find(predicate); if (previous) return Promise.resolve(previous);
    return new Promise<Signal>((resolve, reject) => {
      const waiter = { predicate, resolve: (m: Signal) => { clearTimeout(timer); resolve(m); } };
      const timer = setTimeout(() => { this.waits = this.waits.filter(w => w !== waiter); reject(new Error('Operations server IPC timeout')); }, 5000);
      this.waits.push(waiter);
    });
  }
  async start() {
    const proc = this.proc = spawn(process.execPath, ['--import', 'tsx', this.boot], {
      cwd: process.cwd(), env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT), NODE_ENV: 'test', BIPLANES_DEBUG: '1', BIPLANES_DATA: this.store }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    proc.on('message', message => {
      const signal = message as Signal; this.signals.push(signal);
      for (const waiter of [...this.waits]) if (waiter.predicate(signal)) { this.waits.splice(this.waits.indexOf(waiter), 1); waiter.resolve(signal); }
    });
    let errors = ''; proc.stderr!.on('data', raw => errors += String(raw));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Operations startup timeout: ' + errors)), 6000);
      proc.stdout!.on('data', raw => { if (String(raw).includes('Сервер Бипланы')) { clearTimeout(timer); resolve(); } });
      proc.once('error', error => { clearTimeout(timer); reject(error); });
      proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Operations server exit ${code}: ${errors}`)); });
    });
  }
  async connect() { const peer = new Peer(); this.peers.push(peer); await peer.open(); return peer; }
  async readAccount(token = TOKEN) { return JSON.parse(await readFile(this.store, 'utf8')).find((a: any) => a.token === token); }
  release(id: string, fail = false) { this.proc!.send({ type: 'release-write', id, fail }); }
  async stop() {
    for (const peer of this.peers) peer.ws.terminate(); this.peers = [];
    const proc = this.proc; this.proc = undefined;
    if (proc && proc.exitCode === null) {
      proc.kill(); await new Promise<void>(resolve => { proc.once('exit', () => resolve()); setTimeout(resolve, 3000).unref(); });
    }
  }
  async cleanup() {
    await this.stop(); const path = relative(resolve(tmpdir()), resolve(this.dir));
    assert.ok(path && !path.startsWith('..') && !isAbsolute(path)); await rm(this.dir, { recursive: true, force: true });
  }
}
async function fixture(accounts: Seed[] = [seed()]) {
  const dir = await mkdtemp(join(tmpdir(), 'biplanes-operations-server-')), store = join(dir, 'profiles.json'), boot = join(dir, 'boot.mjs');
  const server = new OperationServer(dir, store, boot), root = process.cwd();
  try {
    await writeFile(store, JSON.stringify(accounts));
    // The gate and observers exist only in this isolated server process. IPC
    // coordinates IO and concurrent auth without sleep-based race assumptions.
    await writeFile(boot, `
      import {readFileSync} from 'node:fs';
      import {createRequire} from 'node:module';
      const require=createRequire(${JSON.stringify(join(root, 'package.json'))});
      const {WebSocketServer}=require('ws');
      const {AtomicStore}=await import(${JSON.stringify(pathToFileURL(join(root, 'server/storage.ts')).href)});
      const write=AtomicStore.prototype.write, emit=WebSocketServer.prototype.emit;
      let armed, gate, serial=0;
      AtomicStore.prototype.write=function() {
        if (!armed) return write.call(this);
        const id=armed; armed=undefined; process.send({type:'write-held',id});
        return new Promise((resolve,reject)=>{gate={id,store:this,resolve,reject};});
      };
      WebSocketServer.prototype.emit=function(event,...args) {
        if(event==='connection') {
          const socket=args[0],connection=++serial,send=socket.send;
          socket.send=function(payload,...options) {
            const message=JSON.parse(String(payload));
            if(['profile','start','state','reply'].includes(message.type)) process.send({type:'outgoing',connection,gateHeld:!!gate,message});
            return send.call(this,payload,...options);
          };
          socket.on('message',payload=>{
            const message=JSON.parse(String(payload));
            if(message.auditHoldWrite) armed=message.auditHoldWrite;
            if(message.type==='auth') process.send({type:'auth-seen',connection});
            if(message.auditMarker) process.send({type:'command-seen',marker:message.auditMarker});
          });
        }
        return emit.call(this,event,...args);
      };
      process.on('message',message=>{
        if(message.type!=='release-write') return;
        const current=gate;
        if(!current || current.id!==message.id) throw new Error('Unexpected test gate');
        gate=undefined;
        if(message.fail) current.reject(Object.assign(new Error('Controlled operations IO failure'),{code:'EIO'}));
        else write.call(current.store).then(()=>{
          process.send({type:'write-committed',id:current.id,accounts:JSON.parse(readFileSync(${JSON.stringify(store)},'utf8'))});
          current.resolve();
        },current.reject);
      });
      await import(${JSON.stringify(pathToFileURL(join(root, 'server/index.ts')).href)});
    `);
    await server.start(); return server;
  } catch (error) { await server.cleanup(); throw error; }
}

test('Skill purchase ACK is durable, spends silver/XP once, and survives server restart', { timeout: 15000 }, async () => {
  const server = await fixture();
  try {
    const peer = await server.connect(), initial = (await peer.auth()).profile, nonce = randomUUID(), gate = randomUUID();
    const buying = peer.spend({ id: 'phase', nonce, auditHoldWrite: gate }); await server.signal(m => m.type === 'write-held' && m.id === gate);
    assert.equal(peer.last('profile').profile.skills?.phase, undefined);
    assert.equal((await server.readAccount()).profile.skills?.phase, undefined);
    server.release(gate); const bought = await buying;
    assert.equal(bought.skills?.phase, true); assert.deepEqual(wallet(bought), { silver: initial.silver-PHASE_SKILL.silver, xp: initial.xp-PHASE_SKILL.xp, totalXp: initial.totalXp, gold: 0 });
    const durable = await server.readAccount(); assert.equal(durable.profile.skills.phase, true); assert.ok(durable.operations[nonce]);
    assert.deepEqual(wallet(await peer.spend({ id: 'phase', nonce })), wallet(bought));
    assert.deepEqual(wallet(await peer.spend({ id: 'phase', nonce: randomUUID() })), wallet(bought));
    await assert.rejects(peer.spend({ id: 'unknown', nonce }), /повтор операции/);
    await server.stop(); await server.start();
    const restored = await server.connect(), state = await restored.auth(); assert.equal(state.profile.skills.phase, true); assert.deepEqual(wallet(state.profile), wallet(bought));
  } finally { await server.cleanup(); }
});

test('Skill validation rejects locked, short XP/silver, unknown skills and invalid nonce without mutation', { timeout: 15000 }, async () => {
  const cases = [
    { token: 'locked', profile: seed('locked', p => { p.defeatedBosses=[]; p.modifierBosses=[]; }), id:'phase', error:/босса/ },
    { token: 'short-silver', profile: seed('short-silver', p => { p.silver=PHASE_SKILL.silver-1; }), id:'phase', error:/серебра/ },
    { token: 'short-xp', profile: seed('short-xp', p => { p.xp=PHASE_SKILL.xp-1; }), id:'phase', error:/опыта/ },
    { token: 'unknown', profile: seed('unknown'), id:'not-a-skill', error:/Неизвестный навык/ },
  ];
  const server = await fixture(cases.map(item => item.profile));
  try {
    for (const item of cases) {
      const peer = await server.connect(), before = (await peer.auth(item.token)).profile, nonce = randomUUID();
      await assert.rejects(peer.spend({ id:item.id, nonce, skills:{phase:true}, unlocked:true }), item.error);
      const current = (await peer.message('refresh')).profile;
      assert.deepEqual(current,before); assert.equal((await server.readAccount(item.token)).operations?.[nonce],undefined);
    }
    const peer = server.peers.at(-1)!, before = (await peer.message('refresh')).profile;
    await assert.rejects(peer.spend({ id:'phase', nonce:'invalid' }), /покупку/);
    assert.deepEqual((await peer.message('refresh')).profile,before);
  } finally { await server.cleanup(); }
});

test('Failed skill persistence restores wallet and nonce; the identical retry buys exactly once', { timeout: 15000 }, async () => {
  const server = await fixture();
  try {
    const peer = await server.connect(), before = (await peer.auth()).profile, nonce = randomUUID(), gate = randomUUID();
    const buying = peer.spend({ id:'phase', nonce, auditHoldWrite:gate }); await server.signal(m => m.type === 'write-held' && m.id === gate);
    server.release(gate,true); await assert.rejects(buying,/Не удалось сохранить/);
    assert.deepEqual((await peer.message('refresh')).profile,before); assert.equal((await server.readAccount()).operations?.[nonce],undefined);
    const bought = await peer.spend({ id:'phase', nonce }); assert.equal(bought.skills?.phase,true);
    assert.equal(bought.silver,before.silver-PHASE_SKILL.silver); assert.equal(bought.xp,before.xp-PHASE_SKILL.xp);
    assert.deepEqual(wallet(await peer.spend({ id:'phase',nonce })),wallet(bought));
  } finally { await server.cleanup(); }
});

test('A queued skill purchase from the closed previous window cannot grant or charge the account', { timeout: 15000 }, async () => {
  const server = await fixture([seed(),seed('unrelated')]);
  try {
    const old = await server.connect(), before = (await old.auth()).profile;
    const unrelated = await server.connect(); await unrelated.auth('unrelated');
    const gate=randomUUID(), holding=unrelated.rpc('debug',{action:'xp',amount:1,auditHoldWrite:gate});
    await server.signal(m=>m.type==='write-held'&&m.id===gate);
    const current=await server.connect(), authenticating=current.auth(); await server.signal(m=>m.type==='auth-seen'&&m.connection===3);
    const nonce=randomUUID(), marker=randomUUID(); old.send({type:'skill-buy',id:'phase',nonce,auditMarker:marker});
    await server.signal(m=>m.type==='command-seen'&&m.marker===marker); server.release(gate); await holding; await authenticating;
    // Another financial command drains the queue behind the cancelled purchase.
    await assert.rejects(current.spend({id:'unknown',nonce:randomUUID()}),/Неизвестный навык/);
    const state=(await current.message('refresh')).profile; assert.deepEqual(wallet(state),wallet(before)); assert.equal(state.skills?.phase,undefined);
    assert.equal((await server.readAccount()).operations?.[nonce],undefined);
    const bought=await current.spend({id:'phase',nonce:randomUUID()}); assert.equal(bought.silver,before.silver-PHASE_SKILL.silver);
  } finally { await server.cleanup(); }
});

test('Owned phase works in career input, stays disabled in online duels, and cannot be purchased in battle', { timeout: 15000 }, async () => {
  const server=await fixture([sortieSeed(p=>{p.skills={phase:true};}),seed('opponent')]);
  try {
    const peer=await server.connect(); await peer.auth(); const intro=(await peer.message('pve',{resume:true},'start')).battle; await peer.ready(intro);
    await assert.rejects(peer.rpc('skill-buy',{id:'phase',nonce:randomUUID()}),/вернитесь в ангар/);
    peer.send({type:'input',turn:0,fire:false,boost:false,skill:true});
    const active=(await peer.wait(m=>m.type==='state'&&m.battle.planes[0].phaseSeconds>0)).battle;
    assert.equal(active.planes[0].phaseSkill,true); assert.ok(active.planes[0].phaseCooldown>30);
    await peer.message('leave');
    const opponent=await server.connect(); await opponent.auth('opponent');
    const ownStart=peer.wait(m=>m.type==='start'), opponentStart=opponent.wait(m=>m.type==='start');
    peer.send({type:'queue'}); opponent.send({type:'queue'}); const duel=(await ownStart).battle; await opponentStart;
    assert.equal(duel.mode,'duel'); assert.equal(duel.planes[0].phaseSkill,false);
    peer.send({type:'input',turn:0,fire:false,boost:false,skill:true});
    const state=(await peer.wait(m=>m.type==='state'&&m.battle.time>duel.time)).battle;
    const pilot=state.planes.find((p:any)=>p.id===peer.last('profile').profile.id);
    assert.equal(pilot.phaseSkill,false); assert.equal(pilot.phaseSeconds,0); assert.equal(pilot.phaseCooldown,0);
  } finally { await server.cleanup(); }
});

test('An old saved sortie resumes automatically, repairs once and never credits its completed mission again', { timeout: 15000 }, async () => {
  const server=await fixture([sortieSeed()]);
  try {
    const peer=await server.connect(), profile=(await peer.auth()).profile;
    const next=(await peer.message('pve',{resume:true},'start')).battle;
    assert.equal(next.phase,'flight'); assert.equal(next.paused,true); assert.ok(next.missionIntro); assert.equal(next.operation.completed,1);
    assert.equal(next.operation.seconds,0); assert.equal(next.operation.killSilver,0); assert.equal(next.operation.killXp,0);
    assert.equal(next.planes[0].health,next.planes[0].hp); assert.equal(next.planes[0].energy,1); assert.equal(next.planes[0].heat,0);
    await assert.rejects(peer.rpc('sortie-next'),/Сначала завершите вылет/);
    const after=(await peer.message('leave')).profile;
    assert.deepEqual(wallet(after),wallet(profile)); assert.deepEqual(after.daily,profile.daily); assert.deepEqual(after.weekly,profile.weekly);
    const reloaded=await server.connect(); await reloaded.auth();
    const resumed=(await reloaded.message('pve',{resume:true},'start')).battle;
    assert.equal(resumed.phase,'flight'); assert.equal(resumed.paused,true); assert.ok(resumed.missionIntro); assert.equal(resumed.operation.completed,1);
    assert.equal(resumed.id,next.id); assert.deepEqual(resumed.earned,next.earned);
  } finally { await server.cleanup(); }
});

test('A live mission pauses for briefing at entry and transition, credits once and preserves its map on reconnect', { timeout:15000 }, async()=>{
  const account=sortieSeed(), checkpoint=account.checkpoint!;
  checkpoint.phase='flight'; checkpoint.paused=false; checkpoint.operation!.completed=0;
  checkpoint.operation!.seconds=operationMission(4).seconds-.02;
  checkpoint.operation!.killSilver=0; checkpoint.operation!.killXp=0;
  checkpoint.spawn=9999; checkpoint.bomberClock=9999;
  const server=await fixture([account]);
  try {
    const first=await server.connect(), before=(await first.auth()).profile;
    const intro=(await first.message('pve',{resume:true},'start')).battle;
    assert.equal(intro.paused,true); assert.ok(intro.missionIntro);
    first.send({type:'pause',paused:false}); first.send({type:'mission-ready',key:'stale',paused:false});
    const frozen=(await first.wait(m=>m.type==='state')).battle;
    assert.equal(frozen.time,intro.time); assert.equal(frozen.operation.seconds,intro.operation.seconds); assert.equal(frozen.paused,true);
    // Register the transition waiter before releasing the nearly completed mission.
    const transition=first.wait(m=>m.type==='state'&&m.battle.operation?.completed===1);
    first.send({type:'mission-ready',key:intro.missionIntro,paused:false});
    const continued=(await transition).battle;
    assert.equal(continued.phase,'flight'); assert.equal(continued.paused,true); assert.notEqual(continued.missionIntro,intro.missionIntro);
    assert.equal(continued.planes[0].health,continued.planes[0].hp);
    assert.ok(!first.messages.some(m=>m.battle?.phase==='sortie-reward'));
    const credited=(await first.message('leave')).profile;
    assert.equal(credited.silver,before.silver+SORTIE_REWARD.silver/2); assert.equal(credited.xp,before.xp+SORTIE_REWARD.xp/2);
    assert.equal(credited.daily.activity,before.daily.activity+1); assert.equal(credited.weekly.activity,before.weekly.activity+1);
    const second=await server.connect(), recovered=(await second.auth()).profile;
    assert.deepEqual(wallet(recovered),wallet(credited));
    const resumed=(await second.message('pve',{resume:true},'start')).battle;
    assert.equal(resumed.phase,'flight'); assert.equal(resumed.paused,true); assert.ok(resumed.missionIntro); assert.equal(resumed.operation.completed,1);
    await assert.rejects(second.rpc('sortie-next'),/Сначала завершите вылет/);
    const final=(await second.message('leave')).profile;
    assert.deepEqual(wallet(final),wallet(credited)); assert.deepEqual(final.daily,credited.daily);
  } finally { await server.cleanup(); }
});
