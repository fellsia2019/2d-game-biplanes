import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { planeStats } from '../shared/data';

test('Мгновенная дуэль с ботом доступна только в очереди с разрешёнными ботами', {timeout:15000}, async () => {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as {port:number}).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const dir = await mkdtemp(join(tmpdir(), 'biplanes-queue-bot-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd:process.cwd(), env:{...process.env, PORT:String(port), HOST:'127.0.0.1', BIPLANES_DATA:join(dir, 'profiles.json')},
    stdio:['ignore', 'pipe', 'pipe'],
  });
  let ws: WebSocket | undefined, errors = '';
  proc.stderr.on('data', data => errors += String(data));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout: ' + errors)), 6000);
      proc.stdout.on('data', data => { if (String(data).includes('Сервер Бипланы')) { clearTimeout(timer); resolve(); } });
      proc.once('error', error => { clearTimeout(timer); reject(error); });
      proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}: ${errors}`)); });
    });
    ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
    const messages: any[] = [];
    const waiters = new Set<{predicate:(message:any)=>boolean; resolve:(message:any)=>void}>();
    ws.on('message', data => {
      const message = JSON.parse(String(data)); messages.push(message);
      for (const waiter of waiters) if (waiter.predicate(message)) { waiters.delete(waiter); waiter.resolve(message); }
    });
    await new Promise<void>((resolve, reject) => { ws!.once('open', resolve); ws!.once('error', reject); });
    function wait(predicate:(message:any)=>boolean) {
      return new Promise<any>((resolve, reject) => {
        const waiter = {predicate, resolve:(message:any) => { clearTimeout(timer); resolve(message); }};
        const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('Queue-bot message timeout')); }, 3000);
        waiters.add(waiter);
      });
    }
    const send = (message:object) => ws!.send(JSON.stringify(message));
    async function call(type:string) {
      const requestId = randomUUID(), result = wait(message => message.type === 'reply' && message.requestId === requestId);
      send({type, requestId}); const reply = await result;
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    }
    const profileWait = wait(message => message.type === 'profile'); send({type:'auth'});
    const profile = (await profileWait).profile;
    await assert.rejects(call('queue-bot'), /очередь/);
    send({type:'bots', allowed:false});
    const disabledWait = wait(message => message.type === 'queued'); send({type:'queue'});
    assert.equal((await disabledWait).allowBots, false);
    await assert.rejects(call('queue-bot'), /разрешите ботов/);
    assert.equal(messages.filter(message => message.type === 'start').length, 0);
    const cancelledWait = wait(message => message.type === 'cancelled'); send({type:'cancel'}); await cancelledWait;
    await assert.rejects(call('queue-bot'), /очередь/);

    send({type:'bots', allowed:true});
    const queueWait = wait(message => message.type === 'queued'); send({type:'queue'}); await queueWait;
    const startWait = wait(message => message.type === 'start'), requestedAt = Date.now();
    const result = await call('queue-bot'), started = await startWait;
    assert.deepEqual(result, {started:true});
    assert.ok(Date.now() - requestedAt < 2500, 'Бот запускается без ожидания таймера очереди');
    assert.equal(started.battle.mode, 'duel');
    assert.equal(started.battle.phase, 'duel');
    assert.equal(started.you, profile.id);
    const bot = started.battle.planes.find((plane:any) => plane.bot);
    assert.ok(bot);
    const player = planeStats(profile);
    for (const key of ['hp', 'speed', 'turn', 'damage'] as const) assert.ok(bot[key] >= player[key] * .9 - 1e-9 && bot[key] <= player[key] * 1.1 + 1e-9, key);
    await assert.rejects(call('queue-bot'), /очередь/);
    assert.equal(messages.filter(message => message.type === 'start').length, 1, 'Повторный запрос не создаёт второй бой');
    const leaveWait = wait(message => message.type === 'profile'); send({type:'leave'}); await leaveWait;
    await assert.rejects(call('queue-bot'), /очередь/);
    const campaignWait = wait(message => message.type === 'start'); send({type:'pve'}); await campaignWait;
    await assert.rejects(call('queue-bot'), /очередь/);
    assert.equal(messages.filter(message => message.type === 'start').length, 2, 'Кампанию нельзя заменить дуэлью без очереди');
  } finally {
    ws?.terminate();
    const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()));
    if (proc.exitCode === null) { proc.kill(); await exited; }
    await rm(dir, {recursive:true, force:true});
  }
});
