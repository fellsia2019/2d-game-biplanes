import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Profile, freshProfile, resetTasks, claimTask, planeStats, bossBalance, GOLD_PACKS, pilotRank, addExperience, ZONE } from '../shared/data';
import { Battle, Controls, IDLE, Reward, createBattle, makePlane, stepBattle, forfeitDuel, approachBoss, startBossFight, finishBossReward, finishSortie, restoreOperationProgress, normalizeCampaignPlane, refreshPlaneStats } from '../shared/simulation';
import { buyPlane, buyModule, equipModule, exchange, researchUpgrade, buyUpgrade, buyPhoenixPart } from './economy';
import { duelBotStats } from './duel-bot';
import { pvoModelsForLevel } from '../shared/terrain';
import { migrateCareer, prepareBossAttempt, finishCareer, ensureModifierOffer, chooseModifier, awardBossModifier, type CareerAccount } from './career';
import { AtomicStore } from './storage';
import { PaymentAccount, verifyPurchases, redeemPurchases } from './payments';
import { hasPremium, normalizePremium, PREMIUM_EARNINGS_MULTIPLIER, PREMIUM_PRODUCT_ID } from '../shared/premium';
import { buySkill } from './skills';
const port = Number(process.env.PORT ?? 5187), host = process.env.HOST ?? '127.0.0.1';
const debugEnabled = process.env.BIPLANES_DEBUG === '1' && process.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost', '::1'].includes(host);
const storePath = process.env.BIPLANES_DATA ?? 'data/profiles.json';
await mkdir(storePath.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
type Account = PaymentAccount & CareerAccount & { token: string; checkpoint?: Battle; restartLevel?: number; restartBoss?: boolean; operations?: Record<string, string> };
let accounts: Account[];
try { accounts = JSON.parse(await readFile(storePath, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; accounts = []; }
for (const a of accounts) { a.profile.modules ??= []; a.profile.module ??= ''; migrateCareer(a); normalizePremium(a.profile); }
const paymentSecret = process.env.YANDEX_PAYMENT_SECRET ?? '';
const disk = new AtomicStore(storePath, () => accounts);
let dirty = false, writing = false, financialBusy = false, financialTail: Promise<unknown> = Promise.resolve();
async function save() {
  if (!dirty || writing || financialBusy) return;
  dirty = false; writing = true;
  try { await disk.write(); }
  catch (e) { dirty = true; console.error('Не удалось сохранить прогресс', e); }
  finally { writing = false; }
}
setInterval(() => void save(), 500);
const http = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ game: 'biplanes', status: 'ok' })); });
const wss = new WebSocketServer({ server: http, path: '/socket', maxPayload: 131072 });
type Client = { ws: WebSocket; account?: Account; input: Controls; battle?: Battle; queued: number; allowBots: boolean; count: number; countAt: number; alive: boolean; commands: Promise<void> };
const clients = new Set<Client>(), battles = new Set<Battle>();
function power(p: Profile) { const s = planeStats(p); return (s.hp / 100 + s.speed / 185 + s.turn / 2.6 + s.damage / 10) / 4; }
function send(c: Client, data: object) { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(data)); }
function profile(c: Client) {
  const a = c.account!; resetTasks(a.profile);
  const previous = a.modifierOffer, bossOffer = ensureModifierOffer(a); if (previous !== bossOffer) dirty = true;
  send(c, { type: 'profile', profile: a.profile, resume: !!a.checkpoint, restartLevel: a.restartLevel ?? 1,
    bossOffer, operationCompleted:a.checkpoint?.operation?.completed ?? a.operationCheckpoint?.completed ?? 0, bossGateLevel: a.checkpoint?.phase === 'boss-intro' ? a.checkpoint.level : a.restartBoss ? a.restartLevel : undefined });
}
function fail(c: Client, message: string) { send(c, { type: 'error', message }); }
function changed(c: Client) { dirty = true; profile(c); }
async function financial<T>(c: Client, work: () => T, diskError = 'Не удалось сохранить покупку. Золото не списано; повторите позже.'): Promise<T> {
  const task = financialTail.then(async () => {
    financialBusy = true;
    let backup: Account | undefined;
    try {
      await disk.idle();
      if (c.ws.readyState !== WebSocket.OPEN) throw new Error('Сессия закрыта. Обновите ангар.');
      backup = structuredClone(c.account!);
      const result = work(); dirty = false; await disk.write(); profile(c); return result;
    }
    catch (e) {
      if (backup) {
        for (const key of Object.keys(c.account!)) if (!(key in backup)) delete (c.account! as unknown as Record<string, unknown>)[key];
        Object.assign(c.account!, backup); dirty = true;
      }
      if ((e as NodeJS.ErrnoException).code) throw new Error(diskError);
      throw e;
    }
    finally { financialBusy = false; }
  });
  financialTail = task.catch(() => {}); return task;
}
async function spend(c: Client, m: any, work: () => void) {
  if (typeof m.nonce !== 'string' || !/^[a-f0-9-]{36}$/i.test(m.nonce)) throw new Error('Повторите покупку в магазине');
  const fingerprint = JSON.stringify({ type: m.type, id: m.id, model: m.model, amount: m.amount, currency: m.currency, branch: m.branch, level: m.level });
  await financial(c, () => {
    const ops = c.account!.operations ??= {};
    if (ops[m.nonce]) { if (ops[m.nonce] !== fingerprint) throw new Error('Некорректный повтор операции'); return; }
    work(); ops[m.nonce] = fingerprint;
  });
}
function applyRewards(rewards: Reward[], participants: Client[]) {
  for (const r of rewards) {
    const c = participants.find(x => x.account!.profile.id === r.player); if (!c) continue;
    const p = c.account!.profile; resetTasks(p); p.silver += r.silver; addExperience(p, r.xp);
    if (r.bossLevel) {
      if (!(p.defeatedBosses ??= []).includes(r.bossLevel)) p.defeatedBosses.push(r.bossLevel);
      c.account!.bossFailures = undefined; awardBossModifier(c.account!, r.bossLevel, c.battle!.id);
    }
    if (r.kind === 'kill') p.daily.kills++;
    if (r.kind === 'sortie' || r.kind === 'duel') { p.daily.activity++; p.weekly.activity++; if (r.win) p.daily.wins++; }
    if (r.kind === 'level') p.weekly.levels++;
    if (r.kind === 'duel') p.weekly.duels++;
    changed(c);
  }
}
function assign(c: Client, battle: Battle) { c.battle = battle; c.queued = 0; c.input = { ...IDLE }; send(c, { type: 'start', battle, you: c.account!.profile.id }); }
function syncPremiumRewards(battle: Battle, participants: Client[], now = Date.now()) {
  for (const c of participants) {
    const pilot = battle.planes.find(p => p.id === c.account!.profile.id);
    if (pilot) pilot.rewardMultiplier = hasPremium(c.account!.profile, now) ? PREMIUM_EARNINGS_MULTIPLIER : 1;
  }
}
function launchDuel(a: Client, b?: Client) {
  const ap = a.account!.profile, bp = b?.account!.profile;
  const enemy = bp ? makePlane(bp.id, planeStats(bp), false, 1) : makePlane('bot', duelBotStats(ap), true, 1);
  const battle = createBattle(randomUUID(), 'duel', [makePlane(ap.id, planeStats(ap)), enemy]);
  battles.add(battle); assign(a, battle); if (b) assign(b, battle);
}
function enterPve(c: Client, resume: boolean) {
  if (c.battle && c.battle.phase !== 'ended') return fail(c, 'Сначала завершите текущий бой');
  const a = c.account!, p = a.profile;
  if (ensureModifierOffer(a)) { profile(c); return; }
  const saved = a.checkpoint && (resume || ['boss', 'boss-intro', 'reward', 'sortie-reward'].includes(a.checkpoint.phase));
  const battle = saved ? structuredClone(a.checkpoint!) : createBattle(randomUUID(), 'pve', [makePlane(p.id, planeStats(p, true))], a.restartLevel ?? 1);
  if (!saved) {
    const progress = a.operationCheckpoint?.level === battle.level ? a.operationCheckpoint.completed : a.checkpoint?.level === battle.level ? a.checkpoint.operation?.completed : 0;
    if (progress) restoreOperationProgress(battle, progress);
  }
  if (saved) {
    refreshPlaneStats(battle.planes[0], planeStats(p, true));
    const boss = battle.planes.find(q=>q.id==='boss');
    if (boss) {
      const balance = bossBalance(battle.level);
      refreshPlaneStats(boss,{model:'enemy',hp:balance.hp,speed:balance.speed,turn:balance.turn,damage:balance.damage});
    }
  }
  const pvoModels = pvoModelsForLevel(battle.level);
  battle.obstacles = battle.obstacles.filter(o => o.kind !== 'pvo' || pvoModels.length > 0);
  for (const o of battle.obstacles) if (o.kind === 'pvo' && !pvoModels.includes(o.pvoModel!)) o.pvoModel = pvoModels[0];
  if (battle.phase === 'flight') normalizeCampaignPlane(battle.planes[0]);
  if (!saved && a.restartBoss) approachBoss(battle);
  if (saved && battle.phase === 'boss') battle.phase = 'boss-intro';
  if (battle.phase === 'reward') finishBossReward(battle);
  prepareBossAttempt(a, battle);
  battle.paused = battle.phase === 'boss-intro' || battle.phase === 'sortie-reward'; battles.add(battle); assign(c, battle); a.checkpoint = battle; dirty = true;
}
function leave(c: Client, disconnected = false) {
  c.queued = 0; c.input = { ...IDLE };
  if (!c.battle) return;
  const battle = c.battle, participants = [...clients].filter(x => x.battle === battle); c.battle = undefined;
  if (battle.mode === 'pve') { if (battle.phase !== 'ended') { battle.paused = true; c.account!.checkpoint = structuredClone(battle); } battles.delete(battle); }
  else {
    const other = [...clients].find(x => x !== c && x.battle === battle);
    if (other && battle.phase !== 'ended') { syncPremiumRewards(battle, participants); applyRewards(forfeitDuel(battle, c.account!.profile.id), participants); battle.result = disconnected ? 'Противник отключился' : 'Противник покинул бой'; send(other, { type: 'state', battle }); }
    battles.delete(battle);
  }
  dirty = true;
}
wss.on('connection', ws => {
  const c: Client = { ws, input: { ...IDLE }, queued: 0, allowBots: true, count: 0, countAt: Date.now(), alive: true, commands: Promise.resolve() }; clients.add(c);
  ws.on('pong', () => c.alive = true);
  ws.on('message', raw => {
    if (Date.now() - c.countAt > 1000) { c.count = 0; c.countAt = Date.now(); }
    if (++c.count > 80) { ws.close(1008, 'Too many messages'); return; }
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { fail(c, 'Некорректное сообщение'); return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) { fail(c, 'Некорректное сообщение'); return; }
    c.commands = c.commands.then(async () => {
    try {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!c.account) {
        if (m.type !== 'auth') return;
        // Join the same queue as durable purchases/choices: a reconnect must
        // never read a grant that can still roll back after a disk failure.
        const authentication = financialTail.then(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          let a = typeof m.token === 'string' ? accounts.find(x => x.token === m.token) : undefined;
          if (!a) { a = { token: randomBytes(32).toString('hex'), profile: freshProfile(randomUUID()), campaignLength: ZONE.length }; accounts.push(a); dirty = true; }
          for (const old of clients) if (old !== c && old.account === a) {
            leave(old, true); old.ws.close(1008, 'Аккаунт открыт в другой вкладке');
          }
          c.account = a; c.allowBots = a.profile.allowBots;
          send(c, { type: 'welcome', token: a.token, you: a.profile.id, paymentsEnabled: !!paymentSecret, debugEnabled }); profile(c);
        });
        financialTail = authentication.catch(() => {});
        await authentication; return;
      }
      const a = c.account, p = a.profile; resetTasks(p);
      if (m.type === 'debug') {
        if (!debugEnabled) throw new Error('Debug-панель отключена');
        if (['xp', 'gold', 'silver'].includes(m.action)) {
          if (!Number.isSafeInteger(m.amount) || m.amount <= 0 || m.amount > 1000000) throw new Error('Укажите целое количество от 1 до 1000000');
          await financial(c, () => {
            if (m.action === 'xp') addExperience(p, m.amount);
            else if (m.action === 'gold') p.gold += m.amount;
            else p.silver += m.amount;
          }, 'Не удалось сохранить debug-ресурсы. Повторите действие.');
        } else {
          const current = c.battle;
          if (!current || current.mode !== 'pve') throw new Error('Сначала запустите кампанию');
          if (ensureModifierOffer(a)) throw new Error('Сначала выберите награду за босса');
          if (m.action === 'next-level') {
            const next = current.level + 1;
            if (next > ZONE.length) throw new Error('Это последний доступный уровень');
            battles.delete(current);
            const nextBattle = createBattle(randomUUID(), 'pve', [makePlane(p.id, planeStats(p, true))], next);
            nextBattle.paused = m.paused === true; a.bossFailures = undefined; a.operationCheckpoint = undefined;
            if (ZONE[next - 1].boss) approachBoss(nextBattle);
            prepareBossAttempt(a, nextBattle); battles.add(nextBattle); assign(c, nextBattle);
            a.restartLevel = next; a.restartBoss = nextBattle.phase === 'boss-intro'; a.checkpoint = structuredClone(nextBattle); dirty = true;
            profile(c);
          } else if (m.action === 'win-boss') {
            if (!ZONE[current.level - 1]?.boss || current.phase === 'ended') throw new Error('На этом уровне нет активного босса');
            if (current.phase === 'flight') approachBoss(current);
            if (current.phase === 'boss-intro') startBossFight(current);
            current.paused = false; c.input = {...IDLE}; current.planes[1].health = 0;
            syncPremiumRewards(current, [c]); applyRewards(stepBattle(current, {}, 0), [c]);
            a.restartLevel = current.level; a.restartBoss = false; a.checkpoint = structuredClone(current); dirty = true;
            send(c, {type:'state', battle:current});
          } else throw new Error('Неизвестное debug-действие');
        }
        if (m.requestId) send(c, {type:'reply', requestId:m.requestId, ok:true, result:{done:true}});
        return;
      }
      if (m.type === 'input') { c.input = { horizontal: typeof m.horizontal === 'number' && Number.isFinite(m.horizontal) ? Math.sign(m.horizontal) : 0, turn: typeof m.turn === 'number' && Number.isFinite(m.turn) ? Math.sign(m.turn) : 0, fire: m.fire === true, boost: m.boost === true, skill:m.skill === true }; return; }
      if (m.type === 'leave') { leave(c); profile(c); return; }
      if (m.type === 'boss-start') {
        if (!c.battle || c.battle.mode !== 'pve') throw new Error('Сначала вернитесь к боссу');
        startBossFight(c.battle); c.battle.paused = m.paused === true; c.input = {...IDLE};
        a.checkpoint = structuredClone(c.battle); dirty = true; send(c, {type:'state', battle:c.battle}); return;
      }
      if (m.type === 'sortie-next') {
        const current = c.battle;
        if (!current || current.phase !== 'sortie-reward') throw new Error('Сначала завершите вылет');
        await financial(c, () => { a.checkpoint = structuredClone(current); return true; }, 'Не удалось сохранить вылет. Повторите продолжение.');
        if (c.ws.readyState !== WebSocket.OPEN || c.battle !== current) return;
        finishSortie(current); current.paused = m.paused === true; c.input = {...IDLE}; a.checkpoint = structuredClone(current); dirty = true;
        send(c, {type:'state', battle:current}); if (m.requestId) send(c, {type:'reply', requestId:m.requestId, ok:true, result:{continued:true}}); return;
      }
      if (m.type === 'modifier-choose') {
        if (typeof m.offerId !== 'string' || typeof m.id !== 'string') throw new Error('Выберите карточку');
        if (c.queued || c.battle && c.battle.phase !== 'reward') throw new Error('Выбор доступен после победы или в меню');
        await financial(c, () => chooseModifier(a, m.offerId, m.id), 'Не удалось сохранить выбор. Карточка не получена; повторите выбор.');
        if (c.battle?.phase === 'reward' && !a.modifierOffer) {
          refreshPlaneStats(c.battle.planes[0], planeStats(a.profile, true)); finishBossReward(c.battle); c.battle.paused = m.paused === true;
          a.checkpoint = structuredClone(c.battle); c.input = {...IDLE}; dirty = true;
          send(c, {type:'state', battle:c.battle});
        }
        if (m.requestId) send(c, {type:'reply', requestId:m.requestId, ok:true, result:{saved:true}});
        return;
      }
      if (m.type === 'pause' && c.battle) {
        const hasHumanOpponent = c.battle.mode === 'duel' && c.battle.planes.every(x => !x.bot);
        if (hasHumanOpponent) { fail(c, 'Онлайн-дуэль продолжается. Возвращайтесь в бой.'); return; }
        c.battle.paused = ['boss-intro', 'reward', 'sortie-reward'].includes(c.battle.phase) || m.paused === true; c.input = { ...IDLE }; dirty = true; return;
      }
      if (m.type === 'bots') { c.allowBots = p.allowBots = m.allowed === true; dirty = true; return; }
      if (m.type === 'queue-bot') {
        if (!c.queued || c.battle) throw new Error('Сначала встаньте в очередь 1×1');
        if (!c.allowBots || !p.allowBots) throw new Error('Сначала разрешите ботов в настройках');
        launchDuel(c);
        if (m.requestId) send(c, {type:'reply', requestId:m.requestId, ok:true, result:{started:true}});
        return;
      }
      if (m.type === 'refresh') { dirty = true; profile(c); return; }
      if (c.battle || c.queued) {
        if (m.type === 'cancel' && c.queued) { c.queued = 0; send(c, { type: 'cancelled' }); }
        else if (m.requestId) throw new Error('Для покупок и восстановления вернитесь в ангар');
        return;
      }
      if (m.type === 'queue') { c.queued = Date.now(); send(c, { type: 'queued', started: c.queued, allowBots: c.allowBots }); return; }
      if (m.type === 'pve') { enterPve(c, m.resume === true); return; }
      if (m.type === 'select') {
        if (!p.owned.includes(m.id)) return fail(c, 'Самолёт ещё не куплен'); p.selected = m.id; changed(c); return;
      }
      if (m.type === 'buy') {
        await spend(c, m, () => buyPlane(c.account!.profile, m.id)); return;
      }
      if (m.type === 'module-buy') { await spend(c, m, () => buyModule(c.account!.profile, m.id, m.model)); return; }
      if (m.type === 'phoenix-part') { await spend(c, m, () => buyPhoenixPart(c.account!.profile, m.branch, m.level)); return; }
      if (m.type === 'skill-buy') { await spend(c, m, () => buySkill(c.account!.profile, m.id)); return; }
      if (m.type === 'module-equip') { equipModule(p, m.id, m.model); changed(c); return; }
      if (m.type === 'exchange') { await spend(c, m, () => exchange(c.account!.profile, m.amount, m.currency)); return; }
      if (m.type === 'payment-order') {
        if (!paymentSecret || !(GOLD_PACKS.some(x => x.id === m.sku) || m.sku === PREMIUM_PRODUCT_ID)) throw new Error('Покупки ещё не подключены');
        const order = await financial(c, () => { const id = randomUUID(); (a.orders ??= {})[id] = { sku: m.sku, createdAt: Date.now() }; return { id }; });
        send(c, { type: 'reply', requestId: m.requestId, ok: true, result: order }); return;
      }
      if (m.type === 'payment-redeem') {
        const purchases = verifyPurchases(m.signature, paymentSecret);
        const result = await financial(c, () => redeemPurchases(a, accounts, purchases), 'Не удалось сохранить покупку. Оплаченная покупка ожидает восстановления; повторите проверку покупок после восстановления связи.');
        send(c, { type: 'reply', requestId: m.requestId, ok: true, result }); return;
      }
      if (m.type === 'research' || m.type === 'upgrade') {
        await spend(c, m, () => {
          if (m.type === 'research') researchUpgrade(p, m.branch, m.level);
          else buyUpgrade(p, m.branch, m.level);
        }); return;
      }
      if (m.type === 'claim') {
        if (m.period !== 'daily' && m.period !== 'weekly') return;
        if (m.key !== undefined && typeof m.key !== 'string') return;
        if (claimTask(p, m.period, m.id, m.key)) changed(c); else profile(c); return;
      }
      if (m.type === 'login') {
        const day = new Date().toISOString().slice(0, 10); if (p.loginDay === day) return;
        p.loginDay = day; p.silver += [100, 120, 140, 160, 180, 200, 300][p.loginIndex % 7]; addExperience(p, [20, 20, 30, 30, 40, 40, 60][p.loginIndex % 7]); p.loginIndex++; changed(c); return;
      }
    } catch (e) {
      const message = e instanceof Error && !(e instanceof SyntaxError) ? e.message : 'Не удалось обработать действие';
      if (m.requestId) send(c, { type: 'reply', requestId: m.requestId, ok: false, error: message }); else fail(c, message);
    }
    });
  });
  ws.on('close', () => { leave(c, true); clients.delete(c); });
  ws.on('error', () => {});
});
let tick = 0;
setInterval(() => {
  const queue = [...clients].filter(c => c.queued && c.account);
  for (const c of queue) {
    if (!c.queued) continue;
    const waited = (Date.now() - c.queued) / 1000;
    const opponent = queue.find(o => o !== c && o.queued && Math.abs(pilotRank(o.account!.profile) - pilotRank(c.account!.profile)) <= Math.min(9, 2 + Math.floor(waited / 15)) && Math.max(power(o.account!.profile), power(c.account!.profile)) / Math.min(power(o.account!.profile), power(c.account!.profile)) <= 1.25 + waited * .005);
    if (opponent) launchDuel(c, opponent);
    else if (Date.now() - c.queued >= 15000 && c.allowBots) launchDuel(c);
  }
  for (const battle of battles) {
    const participants = [...clients].filter(c => c.battle === battle);
    const inputs = Object.fromEntries(participants.map(c => [c.account!.profile.id, c.input]));
    syncPremiumRewards(battle, participants);
    const rewards = stepBattle(battle, inputs, 1 / 30);
    applyRewards(rewards, participants);
    if (battle.mode === 'pve' && participants[0]) {
      const a = participants[0].account!; a.restartLevel = battle.level; a.restartBoss = battle.phase === 'boss' || battle.phase === 'boss-intro';
      prepareBossAttempt(a, battle);
      if (battle.phase === 'reward' && !financialBusy && !ensureModifierOffer(a)) finishBossReward(battle);
      if (battle.phase === 'flight' && a.bossFailures && battle.level > a.bossFailures.level) a.bossFailures = undefined;
      if (battle.phase === 'ended') {
        finishCareer(a, battle); dirty = true;
      } else if (tick % 30 === 0 || rewards.length) { a.checkpoint = structuredClone(battle); dirty = true; }
    }
    if (tick % 2 === 0) for (const c of participants) send(c, { type: 'state', battle });
    if (battle.phase === 'ended') { for (const c of participants) { send(c, { type: 'state', battle }); profile(c); } battles.delete(battle); }
  }
  tick++;
}, 1000 / 30);
setInterval(() => { for (const c of clients) { if (!c.alive) c.ws.terminate(); else { c.alive = false; c.ws.ping(); } } }, 15000);
http.listen(port, host, () => console.log('Сервер Бипланы: http://' + host + ':' + port));
async function shutdown() { for (const c of clients) leave(c, true); await financialTail; await disk.idle(); dirty = true; await save(); process.exit(0); }
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
