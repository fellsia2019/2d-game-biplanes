import Phaser from 'phaser';
import './style.css';
import { SkyScene } from './scene';
import { Platform } from './platform';
import { icon } from './icons';
import { renderLobby, renderHangar, renderStore } from './menu';
import { DAILY, WEEKLY, PLANES, MODULES, rankOf, ZONE, Profile } from '../shared/data';
import { Battle } from '../shared/simulation';
const app = document.querySelector<HTMLDivElement>('#app')!, toastEl = document.querySelector<HTMLDivElement>('#toast')!;
const scene = new SkyScene(), platform = new Platform();
new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 1200, height: 675, backgroundColor: '#92caff', scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true, roundPixels: false }, audio: { noAudio: true } });
let ws: WebSocket, p: Profile | undefined, battle: Battle | undefined, you = '', tab = 'play', inspectedPlane = '', resume = false, restartLevel = 1, queueStarted = 0;
let toastTimer = 0, connected = false, started = false, lastPhase = '', finished = false;
let paymentsEnabled = false, swapAccount = false;
let pendingTrade: object | undefined;
const rpcWaiters = new Map<string, { resolve: (result: any) => void; reject: (error: Error) => void; timer: number }>();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]!));
const needsRotation = () => matchMedia('(pointer: coarse)').matches && innerHeight > innerWidth;
const pauseReasons = new Set<string>(), keys = new Set<string>(), touches = new Map<number, string>();
const orientationGuard = document.querySelector<HTMLDivElement>('#orientation-guard')!;
orientationGuard.innerHTML = '<span class="orientation-symbol">' + icon('rotate') + '</span><h1 id="orientation-title">Поверните устройство</h1><p>Бипланы играются в альбомном режиме.</p><span id="orientation-status">Включите автоповорот и держите телефон горизонтально.</span>';
function syncOrientation() {
  const rotate = needsRotation();
  orientationGuard.hidden = !rotate;
  app.inert = rotate;
  document.querySelector<HTMLDivElement>('#game')!.inert = rotate;
  const status = document.querySelector('#orientation-status')!;
  status.textContent = battle && battle.phase !== 'ended' ? battle.mode === 'duel' && battle.planes.every(x => !x.bot) ? 'Онлайн-дуэль продолжается. Вернитесь в альбомный режим.' : pauseReasons.has('manual') ? 'Полёт на паузе. После поворота нажмите «Продолжить».' : 'Полёт на паузе. Поверните телефон, чтобы продолжить.' : 'Включите автоповорот и держите телефон горизонтально.';
  if (rotate && queueStarted) send({ type: 'cancel' });
  if (rotate !== pauseReasons.has('orientation')) setPause('orientation', rotate);
}
const money = (n: number) => Math.floor(n).toLocaleString('ru-RU');
function send(data: object) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function rpc(type: string, data: object = {}) {
  return new Promise<any>((resolve, reject) => {
    if (ws?.readyState !== WebSocket.OPEN) { reject(new Error('Нет связи с ангаром')); return; }
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => { rpcWaiters.delete(requestId); reject(new Error('Сервер пока не ответил. Покупка останется для восстановления.')); }, 15000);
    rpcWaiters.set(requestId, { resolve, reject, timer }); send({ type, requestId, ...data });
  });
}
function spend(data: object) { send({ ...data, nonce: crypto.randomUUID() }); }
function confirmTrade(data: object, title: string, detail: string) {
  pendingTrade = data;
  document.querySelector('#shop-confirm')?.remove();
  app.insertAdjacentHTML('beforeend', '<div id="shop-confirm" class="shade"><section class="result-panel"><span class="eyebrow">ПОДТВЕРЖДЕНИЕ</span><h1>' + title + '</h1><p>' + detail + '</p><button class="button" data-action="trade-confirm">Подтвердить</button><button class="plain" data-action="trade-cancel">Отмена</button></section></div>');
}
function toast(message: string) { toastEl.textContent = message; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 3500); }
function refreshAudioButtons() {
  for (const action of ['sound', 'music']) for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action="' + action + '"]'))) {
    const muted = action === 'sound' ? scene.audio.muted : scene.audio.musicMuted;
    button.setAttribute('aria-pressed', String(!muted));
    const symbol = button.querySelector('[data-audio-icon]'), state = button.querySelector('[data-audio-state]');
    if (symbol) symbol.innerHTML = icon(action === 'sound' ? muted ? 'muted' : 'volume' : muted ? 'musicOff' : 'music');
    if (state) state.textContent = action === 'sound' ? muted ? 'Выключены' : 'Включены' : muted ? 'Выключена' : 'Включена';
    button.classList.toggle('audio-off', muted);
  }
}
function syncAudio() {
  scene.audio.setScene(!!battle && battle.phase !== 'ended');
  scene.audio.suspend(document.hidden || pauseReasons.size > 0 || !!battle?.paused);
}
function navButton(id: string, icon: string, label: string) { return '<button class="nav-item ' + (tab === id ? 'selected' : '') + '" data-tab="' + id + '"><span>' + icon + '</span>' + label + '</button>'; }
function topbar() {
  if (!p) return '';
  return '<header class="topbar"><a class="brand" href="#" data-tab="play" aria-label="Главный экран">' + icon('compass') + '<span>БИПЛАНЫ</span></a>' +
    (tab !== 'play' && tab !== 'help' && tab !== 'settings' ? '<div class="wallet"><span class="silver" aria-label="Серебро: ' + money(p.silver) + '">' + icon('silver') + '<b>' + money(p.silver) + '</b></span><button class="gold balance-button" data-tab="store" aria-label="Золото: ' + money(p.gold) + '. Открыть магазин">' + icon('gold') + '<b>' + money(p.gold) + '</b></button></div>' : '') + '</header>';
}
function tasks() {
  const day = new Date().toISOString().slice(0, 10), claimed = p!.loginDay === day;
  const archive = (p!.taskArchive ?? []).flatMap(entry => (entry.period === 'daily' ? DAILY : WEEKLY)
    .filter(task => entry.completed.includes(task.id) && !entry.claimed.includes(task.id) && entry.expiresAt > Date.now())
    .map(task => '<section class="task ready"><div class="task-body"><div class="task-title"><span class="task-symbol">' + icon('trophy') + '</span><h3>' + task.name + '</h3></div><p>' + (entry.period === 'daily' ? 'День' : 'Неделя') + ' ' + entry.key + ' · осталось ' + Math.ceil((entry.expiresAt - Date.now()) / 86400000) + ' дн.</p><span class="task-status">Награда сохранена</span></div><div class="task-reward"><span>Награда</span><b>' + icon('silver') + ' ' + money(task.silver) + '<span>+' + task.xp + ' XP</span></b><button class="button" data-claim="' + task.id + '" data-period="' + entry.period + '" data-key="' + entry.key + '">Забрать ' + icon('arrow') + '</button></div></section>')).join('');
  return '<div class="page-heading"><h1>Задачи</h1><span class="rank-note">Обновление в 03:00 МСК</span></div><section class="daily-gift"><span class="gift-symbol">' + icon('trophy') + '</span><div><span class="eyebrow">ДЕНЬ ' + ((p!.loginIndex - (claimed ? 1 : 0)) % 7 + 1) + ' ИЗ 7</span><h2>Награда за вход</h2></div><button class="button gold-button" data-action="login" ' + (claimed ? 'disabled' : '') + '>' + (claimed ? icon('check') + ' Получено сегодня' : 'Забрать · ' + icon('silver') + ' ' + [100, 120, 140, 160, 180, 200, 300][p!.loginIndex % 7]) + '</button></section>' +
    (['daily', 'weekly'] as const).map(period => '<h3 class="task-heading">' + (period === 'daily' ? 'Сегодня' : 'Эта неделя') + '</h3><div class="task-list">' + (period === 'daily' ? DAILY : WEEKLY).map(task => {
      const state = p![period], value = (state as unknown as Record<string, number>)[task.id] ?? 0, done = state.claimed.includes(task.id);
      const ready = value >= task.target;
      return '<section class="task ' + (done ? 'completed' : ready ? 'ready' : '') + '"><div class="task-body"><div class="task-title"><span class="task-symbol">' + icon(done ? 'check' : period === 'weekly' ? 'trophy' : 'tasks') + '</span><h3>' + task.name + '</h3></div><p>' + task.detail + '</p><div class="task-progress"><span>' + (done ? 'Выполнено' : ready ? 'Выполнено — заберите награду' : 'Прогресс') + '</span><b>' + Math.min(value, task.target) + ' / ' + task.target + '</b></div><div class="progress" role="progressbar" aria-label="' + task.name + '" aria-valuemin="0" aria-valuemax="' + task.target + '" aria-valuenow="' + Math.min(value, task.target) + '"><i style="width:' + Math.min(100, value / task.target * 100) + '%"></i></div></div><div class="task-reward"><span>Награда</span><b>' + icon('silver') + ' ' + money(task.silver) + '<span>+' + task.xp + ' XP</span></b><button class="button ' + (done || !ready ? 'subtle' : '') + '" data-claim="' + task.id + '" data-period="' + period + '" data-key="' + state.key + '" ' + (done || !ready ? 'disabled' : '') + '>' + (done ? icon('check') + ' Получено' : ready ? 'Забрать ' + icon('arrow') : 'В процессе') + '</button></div></section>';
    }).join('') + '</div>').join('') + '<p class="muted">Все три недельные задачи: ещё 500 серебра и 150 опыта. Выполненные незабранные награды сохраняются семь дней после окончания периода.</p>' + (archive ? '<h3 class="task-heading">Награды прошлых вылетов</h3><div class="task-list">' + archive + '</div>' : '');
}
function settings() {
  const rows = (['sound', 'music'] as const).map(action => {
    const sound = action === 'sound', muted = sound ? scene.audio.muted : scene.audio.musicMuted;
    return '<button class="audio-setting ' + (muted ? 'audio-off' : '') + '" data-action="' + action + '" aria-label="' + (sound ? 'Звуковые эффекты' : 'Фоновая музыка') + '" aria-pressed="' + !muted + '"><span class="setting-symbol" data-audio-icon>' + icon(sound ? muted ? 'muted' : 'volume' : muted ? 'musicOff' : 'music') + '</span><span class="setting-copy"><b>' + (sound ? 'Звуковые эффекты' : 'Фоновая музыка') + '</b><span>' + (sound ? 'Выстрелы, попадания и награды' : 'Музыка в меню и во время полёта') + '</span></span><span class="audio-state"><span data-audio-state>' + (sound ? muted ? 'Выключены' : 'Включены' : muted ? 'Выключена' : 'Включена') + '</span><i class="toggle-track" aria-hidden="true"></i></span></button>';
  }).join('');
  return '<div class="page-heading"><h1>Настройки</h1></div><section class="settings-panel"><h2>Звук</h2><div class="audio-settings">' + rows + '</div><p class="muted">Настройки сохраняются на этом устройстве.</p></section>';
}
function help() {
  return '<div class="help-heading"><button class="button subtle back-button" data-tab="play">' + icon('arrowLeft') + ' Назад</button><h1>Как летать</h1></div><div class="help-grid"><section class="help-card"><h2>Клавиатура</h2><p><kbd>A</kbd> <kbd>' + icon('arrowLeft') + '</kbd> поворот вверх / против часовой</p><p><kbd>D</kbd> <kbd>' + icon('arrow') + '</kbd> поворот вниз / по часовой</p><p><kbd>Пробел</kbd> удерживать огонь</p><p><kbd>Shift</kbd> форсаж · <kbd>Esc</kbd> пауза</p><p>На телефоне — экранные кнопки. Их можно удерживать одновременно.</p></section><section class="help-card"><h2>Кампания</h2><p>Летите вправо через 50 уровней. Врагов можно уничтожать или обходить. Скалы опасны, огонь ПВО предупреждает о выстреле.</p><p>На уровнях 10, 25 и 50 карта останавливается для боя с боссом. Победа возобновляет полёт.</p><p>При выходе полёт сохраняется. После гибели можно начать текущий уровень заново.</p></section><section class="help-card"><h2>Воздушная дуэль</h2><p>Первый до трёх побед, максимум две минуты. После потери самолёта — новое появление со щитом. Выстрел снимает щит.</p><p>Поиск игрока длится 15 секунд. Если боты разрешены, бой начнётся с ИИ. Бот всегда подписан.</p></section><section class="help-card"><h2>Развитие самолёта</h2><p>Прочность, скорость и огонь улучшаются во вкладке «Самолёты». Следите за перегревом и запасом форсажа.</p><p>Опыт открывает ранги и новые самолёты. Получайте серебро за бой, задачи и ежедневный вход.</p></section></div>';
}
function renderMenu(preserveScroll = false) {
  const scrollTop = preserveScroll ? document.querySelector('.menu-content')?.scrollTop ?? 0 : 0;
  scene.active = false; platform.gameplay(false); document.body.classList.remove('in-flight');
  syncAudio();
  if (!p) { app.innerHTML = '<div class="connecting"><span class="brand-mark">' + icon('gold') + '</span><h1>БИПЛАНЫ</h1><p>' + (connected ? 'Готовим самолёт…' : 'Соединяемся с ангаром…') + '</p></div>'; return; }
  const content = tab === 'play' ? renderLobby(p, resume, restartLevel) : tab === 'fleet' ? renderHangar(p, inspectedPlane) : tab === 'tasks' ? tasks() : tab === 'store' ? renderStore(p, { available: paymentsEnabled && platform.canPay, authorized: platform.authorized, platformAvailable: platform.available, products: platform.products }) : tab === 'settings' ? settings() : help();
  app.innerHTML = '<div class="shell screen-' + tab + '">' + topbar() + '<main class="menu-content">' + content + '</main><nav class="menu-nav" aria-label="Главное меню">' + navButton('play', icon('play'), 'Играть') + navButton('fleet', icon('plane'), 'Самолёты') + navButton('tasks', icon('tasks'), 'Задачи') + navButton('store', icon('store'), 'Магазин') + navButton('settings', icon('settings'), 'Настройки') + '</nav>' + (!connected ? '<div class="connection-warning">Восстанавливаем соединение…</div>' : '') + '</div>';
  const contentElement = document.querySelector('.menu-content'); if (contentElement) contentElement.scrollTop = scrollTop;
}
function renderQueue() {
  app.innerHTML = '<div class="shade"><section class="queue-panel"><span class="eyebrow">ВОЗДУШНАЯ ДУЭЛЬ</span><h1>Поиск соперника</h1><div class="radar"><i></i><span>' + icon('plane') + '</span></div><div class="queue-time"><b id="queue-seconds">0</b><span>сек</span></div><p id="queue-hint">Ищем игрока</p><label class="bot-option"><input id="allow-bots" type="checkbox" ' + (p!.allowBots ? 'checked' : '') + '> Разрешить ботов</label><p class="muted">Бот через 15 секунд, если игрок не найдётся.</p><button class="plain" data-action="cancel">Назад</button></section></div>';
}
function renderBattle() {
  if (!battle) return;
  scene.active = true; document.body.classList.add('in-flight');
  syncAudio();
  app.innerHTML = '<div class="battle-hud"><div class="battle-top"><div class="hud-plane"><b id="hp-text">' + icon('plane') + ' <span id="hp-value"></span></b><div class="meter hp"><i id="hp-bar"></i></div></div><div class="battle-title"><b id="mode-title"></b><small id="mode-subtitle"></small></div><div class="hud-actions"><button class="hud-button" data-action="pause" aria-label="Пауза">' + icon('pause') + '</button><button class="hud-button hud-exit" data-action="home" aria-label="Главный экран">' + icon('exit') + '</button></div></div><div class="level-progress"><i id="level-bar"></i></div><div id="boss-hud"></div><div class="battle-bottom"><div class="instrument"><span>ОРУЖИЕ</span><div class="meter heat"><i id="heat-bar"></i></div></div><div class="instrument"><span>ФОРСАЖ</span><div class="meter energy"><i id="energy-bar"></i></div></div><span id="earned">' + icon('silver') + ' <span id="earned-silver"></span><span id="earned-xp"></span></span></div><div class="touch-controls"><div><button data-control="left" aria-label="Поворот против часовой">' + icon('turnLeft') + '</button><button data-control="right" aria-label="Поворот по часовой">' + icon('turnRight') + '</button></div><div><button class="boost-control" data-control="boost" aria-label="Форсаж">' + icon('boost') + '</button><button class="fire-control" data-control="fire" aria-label="Стрелять">' + icon('target') + '</button></div></div><div id="battle-overlay"></div></div>';
  updateHud();
}
function updateHud() {
  if (!battle) return;
  syncAudio();
  const me = battle.planes.find(x => x.id === you); if (!me) return;
  const setText = (id: string, value: string) => { const el = document.getElementById(id); if (el && el.textContent !== value) el.textContent = value; };
  const bar = (id: string, v: number) => { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, v * 100)) + '%'; };
  setText('hp-value', Math.max(0, Math.ceil(me.health)) + ' / ' + Math.round(me.hp)); bar('hp-bar', me.health / me.hp); bar('heat-bar', me.heat); bar('energy-bar', me.energy);
  const def = ZONE[battle.level - 1], enemy = battle.planes.find(x => x.id !== you);
  setText('mode-title', battle.mode === 'pve' ? (battle.phase === 'boss' ? def.boss!.name : 'УРОВЕНЬ ' + battle.level + ' / 50') : me.score + ' : ' + (enemy?.score ?? 0));
  setText('mode-subtitle', battle.mode === 'pve' ? (battle.phase === 'boss' ? 'ДУЭЛЬ С БОССОМ' : def.name) : (enemy?.bot ? 'БОТ · КУРСАНТ' : 'ОНЛАЙН · ИГРОК') + ' · ' + Math.max(0, Math.ceil(120 - battle.time)) + ' сек');
  bar('level-bar', battle.mode === 'pve' ? battle.distance / def.length : battle.time / 120);
  const earned = battle.earned[you]; setText('earned-silver', '+' + money(earned?.silver ?? 0)); setText('earned-xp', '+' + money(earned?.xp ?? 0) + ' XP');
  const boss = document.getElementById('boss-hud'); if (boss) boss.innerHTML = battle.phase === 'boss' ? '<div class="boss-meter"><i style="width:' + Math.max(0, enemy!.health / enemy!.hp * 100) + '%"></i></div><span>' + Math.max(0, Math.ceil(enemy!.health)) + ' / ' + Math.round(enemy!.hp) + '</span>' : '';
  const phase = battle.paused ? 'paused' : battle.phase;
  if (phase !== lastPhase) { lastPhase = phase; renderOverlay(); }
  if (battle.phase === 'ended' && !finished) { finished = true; keys.clear(); touches.clear(); platform.gameplay(false); scene.audio.play('reward'); }
}
function renderOverlay() {
  const el = document.getElementById('battle-overlay'); if (!el || !battle) return;
  if (battle.phase === 'ended') {
    const me = battle.planes.find(x => x.id === you)!, e = battle.earned[you], duel = battle.mode === 'duel';
    const enemy = battle.planes.find(x => x.id !== you), win = duel && me.score > (enemy?.score ?? 0);
    el.innerHTML = '<div class="shade"><section class="result-panel"><span class="result-symbol">' + (win || battle.level === 50 && me.health > 0 ? '' + icon('gold') + '' : '' + icon('plane') + '') + '</span><span class="eyebrow">' + (duel ? 'ДУЭЛЬ ЗАВЕРШЕНА' : 'КОНЕЦ ВЫЛЕТА · УРОВЕНЬ ' + battle.level) + '</span><h1>' + (duel && battle.result === 'Дуэль завершена' ? win ? 'Победа!' : 'Поражение' : battle.result) + '</h1><div class="result-loot"><b>' + icon('silver') + ' ' + money(e?.silver ?? 0) + '</b><b>+' + money(e?.xp ?? 0) + ' XP</b></div><button class="button" data-action="home">Главный экран ' + icon('arrow') + '</button>' + (!duel && me.health <= 0 ? '<button class="plain" data-action="retry">Повторить уровень ' + battle.level + '</button>' : '') + '</section></div>';
  } else if (battle.paused) el.innerHTML = '<div class="shade"><section class="result-panel"><h1>Пауза</h1><p>Полёт сохранён.</p><button class="button" data-action="resume">Продолжить ' + icon('arrow') + '</button><button class="plain" data-action="home">Главный экран</button></section></div>';
  else el.innerHTML = '';
}
function setPause(reason: string, value: boolean) {
  const onlineDuel = battle?.mode === 'duel' && battle.planes.every(x => !x.bot);
  if (onlineDuel && reason === 'manual') { toast('Онлайн-дуэль продолжается; пауза пока доступна только против ИИ'); return; }
  if (value) pauseReasons.add(reason); else pauseReasons.delete(reason);
  syncAudio();
  keys.clear(); touches.clear(); send({ type: 'input', turn: 0, fire: false, boost: false });
  if (!battle || battle.phase === 'ended') return;
  if (onlineDuel) return;
  send({ type: 'pause', paused: pauseReasons.size > 0 });
  platform.gameplay(pauseReasons.size === 0);
}
function home() { tab = 'play'; send({ type: 'leave' }); battle = undefined; finished = false; pauseReasons.clear(); keys.clear(); touches.clear(); syncOrientation(); renderMenu(); }
document.addEventListener('click', e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('button, a'); if (!target) return;
  scene.audio.unlock();
  if (target.dataset.tab) { e.preventDefault(); tab = target.dataset.tab; if (tab === 'fleet') inspectedPlane = p?.selected ?? ''; renderMenu(); if (tab === 'tasks') send({ type: 'refresh' }); scene.audio.play('click'); return; }
  if (target.dataset.inspect) { inspectedPlane = target.dataset.inspect; if (p?.owned.includes(inspectedPlane) && p.selected !== inspectedPlane) send({ type: 'select', id: inspectedPlane }); else renderMenu(); return; }
  if (target.dataset.select) send({ type: 'select', id: target.dataset.select });
  if (target.dataset.buy) {
    const model = PLANES.find(x => x.id === target.dataset.buy)!;
    if (model.currency === 'gold') confirmTrade({ type: 'buy', id: model.id }, model.name, 'Самолёт навсегда · списать золото: ' + model.price);
    else spend({ type: 'buy', id: model.id });
  }
  if (target.dataset.moduleBuy) { const module = MODULES.find(x => x.id === target.dataset.moduleBuy)!; confirmTrade({ type: 'module-buy', id: module.id }, module.name, 'Модуль навсегда · списать золото: ' + module.price); }
  if (target.dataset.moduleEquip !== undefined) send({ type: 'module-equip', id: target.dataset.moduleEquip });
  if (target.dataset.exchange) { const amount = Number(target.dataset.exchange), currency = target.dataset.currency!; confirmTrade({ type: 'exchange', amount, currency }, 'Обмен золота', 'Списать золото: ' + amount + ' на ' + (currency === 'silver' ? 'серебро: ' + amount * 25 : amount * 8 + ' опыта') + '. Обмен необратим.'); }
  if (target.dataset.pack) void platform.purchase(target.dataset.pack, rpc).then(() => toast('Покупка получена и сохранена')).catch(error => toast(error.message || 'Покупка не завершена'));
  if (target.dataset.upgrade) send({ type: 'upgrade', branch: target.dataset.upgrade });
  if (target.dataset.claim) send({ type: 'claim', id: target.dataset.claim, period: target.dataset.period, key: target.dataset.key });
  switch (target.dataset.action) {
    case 'queue': send({ type: 'queue' }); break;
    case 'pve': send({ type: 'pve', resume }); break;
    case 'cancel': send({ type: 'cancel' }); break;
    case 'login': send({ type: 'login' }); break;
    case 'sound': scene.audio.toggle(); refreshAudioButtons(); break;
    case 'music': scene.audio.toggleMusic(); refreshAudioButtons(); break;
    case 'authorize': void platform.authorize().then(async remote => {
      const local = localStorage.getItem('biplanes-token');
      if (remote && remote !== local) { swapAccount = true; ws.close(); localStorage.setItem('biplanes-token', remote); connect(); }
      else if (local) { await platform.rememberToken(local); if (paymentsEnabled) await platform.recover(rpc); renderMenu(); }
    }).catch(error => toast(error.message || 'Вход не завершён')); break;
    case 'recover': void platform.recover(rpc).then(() => toast('Покупки проверены')).catch(error => toast(error.message)); break;
    case 'trade-confirm': if (pendingTrade) spend(pendingTrade); pendingTrade = undefined; document.querySelector('#shop-confirm')?.remove(); break;
    case 'trade-cancel': pendingTrade = undefined; document.querySelector('#shop-confirm')?.remove(); break;
    case 'pause': setPause('manual', true); break;
    case 'resume': setPause('manual', false); break;
    case 'home': home(); break;
    case 'retry': home(); send({ type: 'pve', resume: false }); break;
  }
});
document.addEventListener('change', e => { const input = e.target as HTMLInputElement; if (input.id === 'allow-bots') { p!.allowBots = input.checked; send({ type: 'bots', allowed: input.checked }); } });
document.addEventListener('keydown', e => {
  if (!battle || battle.phase === 'ended') return;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' && !e.repeat) setPause('manual', !pauseReasons.has('manual'));
  keys.add(e.code); scene.audio.unlock();
});
document.addEventListener('keyup', e => keys.delete(e.code));
document.addEventListener('pointerdown', e => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-control]'); if (!button) return;
  e.preventDefault(); button.setPointerCapture(e.pointerId); touches.set(e.pointerId, button.dataset.control!); button.classList.add('pressed'); scene.audio.unlock();
});
function releasePointer(e: PointerEvent) { touches.delete(e.pointerId); (e.target as HTMLElement).closest('[data-control]')?.classList.remove('pressed'); }
document.addEventListener('pointerup', releasePointer); document.addEventListener('pointercancel', releasePointer);
window.addEventListener('blur', () => setPause('focus', true)); window.addEventListener('focus', () => setPause('focus', false));
document.addEventListener('visibilitychange', () => setPause('hidden', document.hidden));
document.addEventListener('contextmenu', e => e.preventDefault());
setInterval(() => {
  if (queueStarted) { const seconds = Math.floor((Date.now() - queueStarted) / 1000); const counter = document.getElementById('queue-seconds'), hint = document.getElementById('queue-hint'); if (counter) counter.textContent = '' + seconds; if (hint) hint.textContent = seconds < 15 ? 'Ищем пилота близкого ранга' : p?.allowBots ? 'Готовим бой с ботом…' : 'Продолжаем искать игрока'; }
  if (!battle || battle.phase === 'ended' || battle.paused || pauseReasons.size) return;
  const active = new Set(touches.values()), left = keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('ArrowUp') || active.has('left'), right = keys.has('KeyD') || keys.has('ArrowRight') || keys.has('ArrowDown') || active.has('right');
  send({ type: 'input', turn: Number(right) - Number(left), fire: keys.has('Space') || active.has('fire'), boost: keys.has('ShiftLeft') || keys.has('ShiftRight') || active.has('boost') });
}, 1000 / 30);
function connect() {
  const endpoint = import.meta.env.VITE_SERVER_URL || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/socket';
  ws = new WebSocket(endpoint);
  ws.onopen = () => { connected = true; send({ type: 'auth', token: platform.getToken() }); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'welcome') {
      localStorage.setItem('biplanes-token', m.token); you = m.you; paymentsEnabled = m.paymentsEnabled;
      void platform.rememberToken(m.token).then(() => { if (paymentsEnabled) return platform.recover(rpc); }).catch(error => toast(error.message || 'Не удалось сохранить ангар в облаке'));
    }
    if (m.type === 'reply') { const pending = rpcWaiters.get(m.requestId); if (pending) { rpcWaiters.delete(m.requestId); clearTimeout(pending.timer); if (m.ok) pending.resolve(m.result); else pending.reject(new Error(m.error)); } }
    if (m.type === 'profile') {
      const previous = p; p = m.profile; resume = m.resume; restartLevel = m.restartLevel; platform.markReady();
      if (!battle && !queueStarted) {
        renderMenu(true);
        if (previous && previous.id === p!.id) {
          if (rankOf(p!.xp) > rankOf(previous.xp)) { toast('Новый ранг: ' + rankOf(p!.xp) + '!'); scene.audio.play('reward'); }
          else if (p!.gold > previous.gold) { toast('Получено ' + (p!.gold - previous.gold) + ' золота'); scene.audio.play('reward'); }
          else if (p!.silver > previous.silver) { toast('Получено: ' + (p!.silver - previous.silver) + ' серебра и ' + (p!.xp - previous.xp) + ' опыта'); scene.audio.play('reward'); }
          else if (p!.silver < previous.silver) { toast('Самолёт готов к новым вылетам'); scene.audio.play('reward'); }
        }
      }
    }
    if (m.type === 'queued') { queueStarted = Date.now(); renderQueue(); }
    if (m.type === 'cancelled') { queueStarted = 0; renderMenu(); }
    if (m.type === 'start') { battle = m.battle; you = m.you; queueStarted = 0; finished = false; lastPhase = ''; pauseReasons.clear(); renderBattle(); scene.accept(battle!, you); platform.gameplay(true); syncOrientation(); }
    if (m.type === 'state' && battle?.id === m.battle.id) { battle = m.battle; scene.accept(battle!, you); updateHud(); platform.gameplay(!battle!.paused && battle!.phase !== 'ended'); }
    if (m.type === 'error') toast(m.message);
  };
  ws.onclose = e => {
    for (const item of rpcWaiters.values()) { clearTimeout(item.timer); item.reject(new Error('Связь прервалась. Покупки восстановятся при входе.')); } rpcWaiters.clear();
    if (swapAccount) { swapAccount = false; return; }
    connected = false; queueStarted = 0; battle = undefined; pauseReasons.delete('manual'); keys.clear(); touches.clear(); scene.active = false; platform.gameplay(false); syncOrientation(); renderMenu(); toast(e.reason || 'Связь прервалась. Переподключаемся…'); if (e.code !== 1008) setTimeout(connect, 2000);
  };
}
scene.onReady = () => { if (!started) { started = true; renderMenu(); void platform.init(value => setPause('platform', value)).then(connect); } };
platform.onChange = () => { if (p && !battle && !queueStarted) renderMenu(true); };
window.addEventListener('resize', syncOrientation);
matchMedia('(pointer: coarse)').addEventListener('change', syncOrientation);
syncOrientation();
