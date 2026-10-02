// Audit harness only. Does not change game code or use real profiles.
// From repository root: node --import tsx design-review/game-audit/reproduce.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { freshProfile, planeStats, ZONE } from '../../shared/data';
import { beginBoss, createBattle, IDLE, makePlane, stepBattle } from '../../shared/simulation';

const results: Record<string, unknown> = {};
const pilot = () => makePlane('audit-pilot', planeStats(freshProfile('audit-pilot')));
{
  const s = createBattle('audit-boss25', 'pve', [pilot()], 25); beginBoss(s);
  let before;
  for (let i = 0; i < 900 && s.phase === 'boss'; i++) {
    before = structuredClone(s.planes[1]);
    stepBattle(s, { 'audit-pilot': { turn: 1, fire: false, boost: false } }, 1 / 30);
  }
  assert.equal(s.level, 26); assert.equal(s.phase, 'flight');
  assert.equal(s.earned['audit-pilot'].silver, 390);
  results.boss25Suicide = { time: s.time, before, afterLevel: s.level, playerHP: s.planes[0].health, earned: s.earned['audit-pilot'] };
}
for (const level of [1, 10]) {
  const s = createBattle('audit-death-boundary', 'pve', [pilot()], level);
  s.distance = ZONE[level - 1].length - 1; s.planes[0].y = 599; s.planes[0].angle = .5;
  const rewards = stepBattle(s, {}, 1 / 30);
  assert.equal(s.phase, level === 1 ? 'ended' : 'boss');
  assert.equal(s.planes[0].health, level === 1 ? 0 : 100);
  results['deathAtBoundary' + level] = { phase: s.phase, afterLevel: s.level, hp: s.planes[0].health, rewards };
}
{
  const s = createBattle('audit-tail-gun', 'pve', [pilot()]); s.planes[0].x = 390;
  s.obstacles = [{ id: 42, kind: 'fighter', x: 200, y: 330, radius: 24, hp: 100, fire: 0, damage: 5 }];
  stepBattle(s, {}, 1 / 30);
  const bullet = s.bullets.find(b => b.owner === 'obstacle-42')!;
  assert.ok(bullet.vx > 0);
  results.fighterShootsBackwards = { fighterX: s.obstacles[0].x, playerX: s.planes[0].x, bullet };
}
{
  const measurements = [];
  for (const module of ['', 'carburetor', 'radiator']) {
    const profile = freshProfile('power'); profile.modules = ['carburetor', 'radiator']; profile.module = module;
    const s = planeStats(profile);
    const matchmakingPower = (s.hp / 100 + s.speed / 185 + s.turn / 2.6 + s.damage / 10) / 4;
    measurements.push({ module, matchmakingPower, cooling: s.cooling, boostDuration: s.boostDuration });
  }
  results.modulePower = measurements;
}
{
  const measurements = [];
  for (const module of ['', 'radiator']) {
    const p = freshProfile('audit-pilot'); p.modules = ['radiator']; p.module = module;
    const stats = planeStats(p), s = createBattle('audit-dps', 'pve', [makePlane(p.id, stats)]);
    // Isolate weapon cadence from movement, enemies and level transitions.
    s.spawn = Infinity; s.distance = -1e9; s.planes[0].speed = 0;
    for (let i = 0; i < 3600; i++) stepBattle(s, { [p.id]: { turn: 0, fire: true, boost: false } }, 1 / 30);
    const shots = s.seq / 2; // Each shot allocates one bullet ID and one shot-effect ID.
    measurements.push({ module, seconds: s.time, shots, damagePerSecond: shots * stats.damage / s.time });
  }
  results.sustainedWeaponDamage = measurements;
}

class Peer {
  ws: WebSocket;
  constructor(port: number) { this.ws = new WebSocket(`ws://127.0.0.1:${port}/socket`); }
  next(type: string) {
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.ws.off('message', handler); reject(new Error('Timeout: ' + type)); }, 4000);
      const handler = (raw: Buffer) => { const message = JSON.parse(raw.toString()); if (message.type === type) { clearTimeout(timer); this.ws.off('message', handler); resolve(message); } };
      this.ws.on('message', handler);
    });
  }
  async command(type: string, message: object, response: string) {
    const pending = this.next(response); this.ws.send(JSON.stringify({ type, ...message })); return pending;
  }
}

const dir = await mkdtemp(join(tmpdir(), 'biplanes-audit-'));
const profile = freshProfile('audit-pilot');
profile.owned.push('swift'); profile.modules.push('carburetor'); profile.xp = 500; profile.silver = 1000;
const checkpoint = createBattle('audit-saved-sortie', 'pve', [makePlane(profile.id, planeStats(profile))]); checkpoint.paused = true;
const store = join(dir, 'profiles.json');
await writeFile(store, JSON.stringify([{ token: 'audit-fixture-token', profile, checkpoint, restartLevel: 1 }]));
const port = 5299;
const proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(port), BIPLANES_DATA: store, YANDEX_PAYMENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let peer: Peer | undefined;
try {
  await new Promise<void>((resolve, reject) => { proc.stdout.on('data', data => { if (String(data).includes('Сервер Бипланы')) resolve(); }); proc.once('exit', code => reject(new Error('Server exit ' + code))); setTimeout(() => reject(new Error('Server startup timeout')), 4000).unref(); });
  peer = new Peer(port); await once(peer.ws, 'open');
  await peer.command('auth', { token: 'audit-fixture-token' }, 'profile');
  await peer.command('select', { id: 'swift' }, 'profile');
  await peer.command('upgrade', { branch: 'hull' }, 'profile');
  const menu = await peer.command('module-equip', { id: 'carburetor' }, 'profile');
  const resumed = await peer.command('pve', { resume: true }, 'start');
  assert.equal(menu.profile.selected, 'swift'); assert.equal(resumed.battle.planes[0].model, 'universal');
  assert.equal(resumed.battle.planes[0].boostDuration, 2);
  results.checkpointIgnoresHangar = { selected: menu.profile.selected, selectedStats: planeStats(menu.profile), resumedPlane: resumed.battle.planes[0] };
  await peer.command('leave', {}, 'profile');
  const restarted = await peer.command('pve', { resume: false }, 'start');
  assert.equal(restarted.battle.planes[0].model, 'swift'); assert.equal(restarted.battle.planes[0].boostDuration, 3);
  results.explicitRestartAppliesHangar = restarted.battle.planes[0];
} finally {
  peer?.ws.close(); proc.kill();
  if (proc.exitCode === null) await once(proc, 'exit');
}
await writeFile('design-review/game-audit/reproduction-results.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
console.log('Temporary isolated profile fixture retained at ' + dir);
