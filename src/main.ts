import Phaser from 'phaser';
import './style.css';
import { FlightLesson, tutorialKey, needsBossLesson, lessonInput, createTrainingBattle, stepTrainingBattle, type TutorialMode } from './tutorial';
import { flightControls, joystickTurn, joystickHorizontal } from './controls';
import { SkyScene } from './scene';
import { Platform } from './platform';
import { icon } from './icons';
import { renderLobby, renderHangar, renderStore, renderSkills } from './menu';
import { mountCareerSlider, destroyCareerSlider } from './career-slider';
import { chooseTutorialPosition, type TutorialPosition } from './tutorial-layout';
import { DAILY, WEEKLY, PLANES, MODULES, pilotRank, ZONE, Profile, careerStage, bossBalance, campaignReward } from '../shared/data';
import { bossAircraft } from './aircraft';
import { LoadingScreen } from './loading';
import { renderModifiers, renderModifierReward } from './modifier-cards';
import { DebugPanel } from './debug';
import type { ModifierOffer } from '../shared/modifiers';
import { combatReward } from '../shared/premium';
import { phoenixPartRequirements } from '../shared/phoenix';
import type { Upgrade } from '../shared/data';
import { Battle } from '../shared/simulation';
import { operationPlan, operationMission, missionProgress, sortieReward } from '../shared/operations';
const app = document.querySelector<HTMLDivElement>('#app')!, toastEl = document.querySelector<HTMLDivElement>('#toast')!;
const scene = new SkyScene(), platform = new Platform();
const loading = new LoadingScreen(); loading.stage('Загружаем самолёты и небо…', 0);
const debug = import.meta.env.DEV ? new DebugPanel((action, amount) => rpc('debug', {action, amount, paused:true}), open => setPause('debug', open), toast) : undefined;
new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 1200, height: 675, backgroundColor: '#92caff', scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true, roundPixels: false }, audio: { noAudio: true } });
let ws: WebSocket, p: Profile | undefined, battle: Battle | undefined, you = '', tab = 'play', inspectedPlane = '', resume = false, restartLevel = 1, operationCompleted = 0, queueStarted = 0;
let toastTimer = 0, connected = false, started = false, lastPhase = '', finished = false;
let paymentsEnabled = false, swapAccount = false;
let bossOffer: ModifierOffer | undefined, bossGateLevel: number | undefined, modifierFilter: 'all' | 'owned' = 'owned', choosingModifier = false;
let hudIntroKey = '', hudIntroAt = 0, lessonPosition: TutorialPosition | undefined;
let pendingTrade: object | undefined;
let lesson: FlightLesson | undefined, afterLesson: (() => void) | undefined;
let lessonBoss: Battle | undefined;
const learned = new Set<string>();
function hasLearned(mode: TutorialMode) {
  if (!p) return false;
  const key = tutorialKey(p.id, mode);
  try { return learned.has(key) || localStorage.getItem(key) === 'done'; } catch { return learned.has(key); }
}
function startBossWithLesson() {
  if (!p || battle?.phase !== 'boss-intro') return;
  pauseReasons.delete('manual'); clearControls();
  if (!needsBossLesson(hasLearned)) { send({type:'boss-start', paused:pauseReasons.size > 0}); return; }
  // The real boss stays in the server's locked introduction while this local lesson runs.
  lessonBoss = battle; lesson = new FlightLesson('duel');
  afterLesson = () => {
    battle = lessonBoss; lessonBoss = undefined; finished = false; lastPhase = ''; clearControls();
    renderBattle(); scene.accept(battle!, you);
    send({type:'boss-start', paused:pauseReasons.size > 0});
  };
  battle = createTrainingBattle('boss-training-' + crypto.randomUUID(), 'duel', p);
  finished = false; lastPhase = ''; renderBattle(); scene.accept(structuredClone(battle), you); syncOrientation();
}
let stickPointer: number | undefined, stickX = 0, stickY = 0, skillPulseFrames = 0;
let forceTouch = localStorage.getItem('biplanes-touch-controls') === '1';
const touchDevice = () => forceTouch || matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
function clearControls() {
  keys.clear(); touches.clear(); stickPointer = undefined; stickX = stickY = 0; skillPulseFrames = 0;
  document.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed'));
  document.querySelector<HTMLElement>('.stick-knob')?.style.setProperty('transform', 'translate(0,0)');
}
function beginLesson(mode: TutorialMode, replay = false) {
  if (!p || !connected || battle) return;
  if (mode === 'pve' && bossOffer) { renderMenu(); return; }
  const launch = () => send(mode === 'pve' ? { type: 'pve', resume } : { type: 'queue' });
  const done = hasLearned(mode);
  if (done && !replay) { launch(); return; }
  lesson = new FlightLesson(mode); afterLesson = replay ? undefined : launch;
  battle = createTrainingBattle('tutorial-' + crypto.randomUUID(), mode, p);
  you = p.id; finished = false; lastPhase = ''; pauseReasons.clear(); clearControls();
  renderBattle(); scene.accept(structuredClone(battle), you); syncOrientation();
}
function finishLesson() {
  if (!lesson || !p) return;
  const key = tutorialKey(p.id, lesson.mode); learned.add(key); try { localStorage.setItem(key, 'done'); } catch {}
  const launch = afterLesson; lesson = undefined; afterLesson = undefined; battle = undefined; clearControls(); pauseReasons.clear(); renderMenu(); launch?.();
}
function positionLesson() {
  if (!lesson || !battle) return;
  const hud = document.querySelector<HTMLElement>('.battle-hud'), hole = document.querySelector<HTMLElement>('.tutorial-spotlight');
  if (!hud || !hole) return;
  const bounds = hud.getBoundingClientRect();
  const target = touchDevice() ? document.querySelector<HTMLElement>(lesson.target === 'stick' ? '.flight-stick' : '[data-control="' + lesson.target + '"]') : undefined;
  if (target) { const r = target.getBoundingClientRect(); Object.assign(hole.style, { left: (r.left - bounds.left - 8) + 'px', top: (r.top - bounds.top - 8) + 'px', width: (r.width + 16) + 'px', height: (r.height + 16) + 'px', borderRadius: '50%' }); }
  else { const me = battle.planes[0], scale = bounds.width / 1200; Object.assign(hole.style, { left: (me.x * scale - 95 * scale) + 'px', top: (me.y * scale - 50 * scale) + 'px', width: 190 * scale + 'px', height: 100 * scale + 'px', borderRadius: '24px' }); }
  const card = document.querySelector<HTMLElement>('.tutorial-card'); if (!card) return;
  const me = battle.planes[0], scale = bounds.width / 1200, cos = Math.abs(Math.cos(me.angle)), sin = Math.abs(Math.sin(me.angle));
  const halfX = (cos * 128 + sin * 64) * scale / 2, halfY = (sin * 128 + cos * 64) * scale / 2;
  const focus = target?.getBoundingClientRect();
  if (!document.body.classList.contains('lesson-rail')) {
    lessonPosition = chooseTutorialPosition({width:bounds.width, height:bounds.height}, {width:card.offsetWidth, height:card.scrollHeight}, {x:me.x * scale - halfX, y:me.y * scale - halfY, width:halfX * 2, height:halfY * 2}, focus ? {x:focus.left-bounds.left, y:focus.top-bounds.top, width:focus.width, height:focus.height} : undefined, lessonPosition);
  }
  if (lessonPosition?.placement === 'rail') {
    document.body.classList.add('lesson-rail');
    document.body.style.setProperty('--lesson-rail-height', Math.min(140, Math.max(90, card.scrollHeight + 16)) + 'px');
    Object.assign(card.style, {left:'0', top:'calc(100% + 8px)', right:'auto', bottom:'auto', width:'100%', maxWidth:'none', maxHeight:'calc(var(--lesson-rail-height) - 16px)', overflowY:'auto'});
  } else if (lessonPosition) Object.assign(card.style, {left:lessonPosition.left+'px', top:lessonPosition.top+'px', right:'auto', bottom:'auto', maxWidth:lessonPosition.maxWidth ? lessonPosition.maxWidth+'px' : '', maxHeight:lessonPosition.maxHeight ? lessonPosition.maxHeight+'px' : '', overflowY:lessonPosition.maxHeight ? 'auto' : ''});
}
function renderLesson() {
  if (!lesson) return;
  lessonPosition = undefined; document.body.classList.remove('lesson-rail');
  const mobile = touchDevice(), copy = lesson.copy(mobile), el = document.querySelector('#battle-overlay'); if (!el) return;
  el.innerHTML = '<div class="tutorial-layer" role="dialog" aria-modal="true" aria-labelledby="lesson-title" tabindex="-1"><div class="tutorial-spotlight"><span class="tutorial-hand" aria-hidden="true">☝</span></div><section class="tutorial-card"><span class="eyebrow">' + lesson.step + '/4</span>' + (lessonBoss ? '<span class="boss-lesson-note">У БОССА — НОВОЕ УПРАВЛЕНИЕ</span>' : '') + '<h2 id="lesson-title">' + copy.title + '</h2><p>' + copy.text + '</p>' + (!mobile && copy.key ? '<kbd class="lesson-key">' + copy.key + '</kbd>' : '') + (lessonBoss ? '<small>Босс ждёт на паузе. Здесь вы неуязвимы.</small>' : '') + '</section></div>';
  document.querySelectorAll('.tutorial-focus').forEach(el => el.classList.remove('tutorial-focus'));
  if (mobile && lesson.step > 0 && lesson.step < 5) document.querySelector(lesson.target === 'stick' ? '.flight-stick' : '[data-control="' + lesson.target + '"]')?.classList.add('tutorial-focus');
  positionLesson();
  el.querySelector<HTMLElement>('.tutorial-layer')?.focus();
}
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
  status.textContent = battle && battle.phase !== 'ended' ? !lesson && battle.mode === 'duel' && battle.planes.every(x => !x.bot) ? 'Онлайн-дуэль продолжается. Вернитесь в альбомный режим.' : pauseReasons.has('manual') ? 'Полёт на паузе. После поворота нажмите «Продолжить».' : 'Полёт на паузе. Поверните телефон, чтобы продолжить.' : 'Включите автоповорот и держите телефон горизонтально.';
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
    (tab !== 'play' && tab !== 'help' && tab !== 'settings' ? '<div class="wallet"><span class="silver" aria-label="Серебро: ' + money(p.silver) + '">' + icon('silver') + '<b>' + money(p.silver) + '</b></span><button class="gold balance-button" data-tab="store" aria-label="Золото: ' + money(p.gold) + '. Открыть магазин">' + icon('gold') + '<b>' + money(p.gold) + '</b></button><span class="xp" aria-label="Опыт">' + icon('xp') + money(p.xp) + ' XP</span></div>' : '') + '</header>';
}
function tasks() {
  const day = new Date().toISOString().slice(0, 10), claimed = p!.loginDay === day;
  const archive = (p!.taskArchive ?? []).flatMap(entry => (entry.period === 'daily' ? DAILY : WEEKLY)
    .filter(task => entry.completed.includes(task.id) && !entry.claimed.includes(task.id) && entry.expiresAt > Date.now())
    .map(task => '<section class="task ready"><div class="task-body"><div class="task-title"><span class="task-symbol">' + icon('trophy') + '</span><h3>' + task.name + '</h3></div><p>' + (entry.period === 'daily' ? 'День' : 'Неделя') + ' ' + entry.key + ' · осталось ' + Math.ceil((entry.expiresAt - Date.now()) / 86400000) + ' дн.</p><span class="task-status">Награда сохранена</span></div><div class="task-reward"><span>Награда</span><b class="silver">' + icon('silver') + ' ' + money(task.silver) + '<span class="xp">+' + task.xp + ' XP</span></b><button class="button" data-claim="' + task.id + '" data-period="' + entry.period + '" data-key="' + entry.key + '">Забрать ' + icon('arrow') + '</button></div></section>')).join('');
  return '<div class="page-heading"><h1>Задачи</h1><span class="rank-note">Обновление в 03:00 МСК</span></div><section class="daily-gift"><span class="gift-symbol">' + icon('trophy') + '</span><div><span class="eyebrow">ДЕНЬ ' + ((p!.loginIndex - (claimed ? 1 : 0)) % 7 + 1) + ' ИЗ 7</span><h2>Награда за вход</h2></div><button class="button silver-button" data-action="login" ' + (claimed ? 'disabled' : '') + '>' + (claimed ? icon('check') + ' Получено сегодня' : 'Забрать · <span class="silver">' + icon('silver') + ' ' + [100, 120, 140, 160, 180, 200, 300][p!.loginIndex % 7] + '</span>') + '</button></section>' +
    (['daily', 'weekly'] as const).map(period => '<h3 class="task-heading">' + (period === 'daily' ? 'Сегодня' : 'Эта неделя') + '</h3><div class="task-list">' + (period === 'daily' ? DAILY : WEEKLY).map(task => {
      const state = p![period], value = (state as unknown as Record<string, number>)[task.id] ?? 0, done = state.claimed.includes(task.id);
      const ready = value >= task.target;
      return '<section class="task ' + (done ? 'completed' : ready ? 'ready' : '') + '"><div class="task-body"><div class="task-title"><span class="task-symbol">' + icon(done ? 'check' : period === 'weekly' ? 'trophy' : 'tasks') + '</span><h3>' + task.name + '</h3></div><p>' + task.detail + '</p><div class="task-progress"><span>' + (done ? 'Выполнено' : ready ? 'Выполнено — заберите награду' : 'Прогресс') + '</span><b>' + Math.min(value, task.target) + ' / ' + task.target + '</b></div><div class="progress" role="progressbar" aria-label="' + task.name + '" aria-valuemin="0" aria-valuemax="' + task.target + '" aria-valuenow="' + Math.min(value, task.target) + '"><i style="width:' + Math.min(100, value / task.target * 100) + '%"></i></div></div><div class="task-reward"><span>Награда</span><b class="silver">' + icon('silver') + ' ' + money(task.silver) + '<span class="xp">+' + task.xp + ' XP</span></b><button class="button ' + (done || !ready ? 'subtle' : '') + '" data-claim="' + task.id + '" data-period="' + period + '" data-key="' + state.key + '" ' + (done || !ready ? 'disabled' : '') + '>' + (done ? icon('check') + ' Получено' : ready ? 'Забрать ' + icon('arrow') : 'В процессе') + '</button></div></section>';
    }).join('') + '</div>').join('') + '<p class="muted">Все три недельные задачи: ещё 500 серебра и 150 опыта. Выполненные незабранные награды сохраняются семь дней после окончания периода.</p>' + (archive ? '<h3 class="task-heading">Награды прошлых вылетов</h3><div class="task-list">' + archive + '</div>' : '');
}
function settings() {
  const rows = (['sound', 'music'] as const).map(action => {
    const sound = action === 'sound', muted = sound ? scene.audio.muted : scene.audio.musicMuted;
    return '<button class="audio-setting ' + (muted ? 'audio-off' : '') + '" data-action="' + action + '" aria-label="' + (sound ? 'Звуковые эффекты' : 'Фоновая музыка') + '" aria-pressed="' + !muted + '"><span class="setting-symbol" data-audio-icon>' + icon(sound ? muted ? 'muted' : 'volume' : muted ? 'musicOff' : 'music') + '</span><span class="setting-copy"><b>' + (sound ? 'Звуковые эффекты' : 'Фоновая музыка') + '</b><span>' + (sound ? 'Выстрелы, попадания и награды' : 'Музыка в меню и во время полёта') + '</span></span><span class="audio-state"><span data-audio-state>' + (sound ? muted ? 'Выключены' : 'Включены' : muted ? 'Выключена' : 'Включена') + '</span><i class="toggle-track" aria-hidden="true"></i></span></button>';
  }).join('');
  return '<div class="page-heading"><h1>Настройки</h1></div><section class="settings-panel"><h2>Звук</h2><div class="audio-settings">' + rows + '</div><h2>Управление</h2><button class="audio-setting" data-action="touch-setting" aria-pressed="' + forceTouch + '"><span class="setting-symbol">' + icon('turnRight') + '</span><span class="setting-copy"><b>Всегда показывать экранное управление</b><span>Круговой контрол и огонь. На телефоне включаются автоматически.</span></span><span class="audio-state">' + (forceTouch ? 'Включено' : 'Автоматически') + '</span></button><p class="muted">Настройки сохраняются на этом устройстве.</p></section>';
}
function help() {
  return '<div class="help-heading"><button class="button subtle back-button" data-tab="play">' + icon('arrowLeft') + ' Назад</button><h1>Как летать</h1></div><div class="help-grid"><section class="help-card"><h2>Обучение</h2><p>Безопасный полёт с подсказками для вашего устройства.</p><button class="button" data-action="tutorial-pve">Повторить: карьера</button><button class="button subtle" data-action="tutorial-duel">Повторить: один на один</button><h2>Клавиатура</h2><p><b>Обычные уровни карьеры:</b> <kbd>W</kbd> вверх, <kbd>S</kbd> вниз; <kbd>D</kbd> вперёд, <kbd>A</kbd> назад. Самолёт летит горизонтально.</p><p><b>Дуэль и боссы:</b> <kbd>A</kbd> <kbd>' + icon('arrowLeft') + '</kbd> поворот вверх / против часовой</p><p><kbd>D</kbd> <kbd>' + icon('arrow') + '</kbd> поворот вниз / по часовой</p><p><kbd>Пробел</kbd> удерживать огонь</p><p><kbd>Shift</kbd> форсаж · <kbd>Esc</kbd> пауза</p><p>На телефоне — круговой контрол слева и огонь справа. Их можно удерживать одновременно.</p></section><section class="help-card"><h2>Кампания</h2><p>Летите вправо через 250 уровней и 11 боссов. Врагов можно уничтожать или обходить. Скалы опасны, огонь ПВО предупреждает о выстреле.</p><p>Первый этап — 1–10, затем 11–25 и 26–50. После 50-го каждый этап длится 25 уровней и завершается боссом. Перед боссом полёт останавливается: можно зайти в ангар и вернуться. При первом бое с поворотным управлением покажем безопасное обучение.</p><p>При выходе полёт сохраняется. Уровень состоит из коротких вылетов с разными задачами: перехват, разведка, снабжение, ПВО, конвой, патруль и командир звена. После гибели повторяется текущий вылет, завершённые сохраняются. Между вылетами самолёт ремонтируют. За выполненный вылет гарантирован минимальный общий доход: награды за уничтожения уже входят в него, всё сверх минимума остаётся вам. На босса — 3 попытки, затем возврат к началу текущего этапа. Победа даёт выбор постоянного модификатора: ваши модификаторы видны в меню и сохраняются на любом самолёте.</p></section><section class="help-card"><h2>Бомбардировщики и навык</h2><p>Перед сбросом бомб сверху появляется пунктирная полоса. Уйдите с неё: крупные бомбы падают медленно и не меняют направление.</p><p>После босса 10 можно купить «Фазовый проход» во вкладке «Навыки» за серебро и опыт. E или фиолетовая кнопка: 2 секунды сквозь скалы, ПВО и самолёты, восстановление 35 секунд. Бомбы, пули и земля остаются опасными.</p></section><section class="help-card"><h2>Воздушная дуэль</h2><p>Первый до трёх побед, максимум две минуты. После потери самолёта — новое появление со щитом. Выстрел снимает щит.</p><p>Поиск игрока длится 15 секунд. Если боты разрешены, можно сразу нажать «Сразу в бой с ботом» или дождаться ИИ. Бот всегда подписан.</p></section><section class="help-card"><h2>Развитие самолёта</h2><p>Прочность, скорость и огонь улучшаются во вкладке «Самолёты». Следите за перегревом и запасом форсажа.</p><p>У бесплатных самолётов три ветки по 15 улучшений. Феникс доступен со старта за золото: сначала равен Стрижу, затем развивается через 6 ступеней золотых деталей, открываемых победами над боссами. Для следующего бесплатного самолёта нужны полная прокачка предыдущего и победа над нужным боссом. Опыт расходуется на исследование улучшений, серебро — на их покупку. Получайте серебро за бой, задачи и ежедневный вход.</p></section></div>';
}
function renderMenu(preserveScroll = false) {
  destroyCareerSlider(); document.body.classList.remove('lesson-rail');
  debug?.update(p, battle, !!lesson);
  const scrollTop = preserveScroll ? document.querySelector('.menu-content')?.scrollTop ?? 0 : 0;
  scene.active = false; platform.gameplay(false); document.body.classList.remove('in-flight');
  syncAudio();
  if (!p) { app.innerHTML = '<div class="connecting"><span class="brand-mark">' + icon('gold') + '</span><h1>БИПЛАНЫ</h1><p>' + (connected ? 'Готовим самолёт…' : 'Соединяемся с ангаром…') + '</p></div>'; return; }
  const content = tab === 'play' ? renderLobby(p, resume, restartLevel, operationCompleted) : tab === 'fleet' ? renderHangar(p, inspectedPlane) : tab === 'modifiers' ? renderModifiers(p, modifierFilter) : tab === 'skills' ? renderSkills(p) : tab === 'tasks' ? tasks() : tab === 'store' ? renderStore(p, { available: paymentsEnabled && platform.canPay, authorized: platform.authorized, platformAvailable: platform.available, products: platform.products }) : tab === 'settings' ? settings() : help();
  const gate = bossGateLevel ? '<aside class="boss-return"><span>' + icon('target') + '<span><b>' + bossBalance(bossGateLevel).name + ' ждёт</b><small>Бой сохранён · уровень ' + bossGateLevel + '</small></span></span><button class="button" data-action="boss-return">К боссу ' + icon('arrow') + '</button></aside>' : '';
  app.innerHTML = '<div class="shell screen-' + tab + '">' + topbar() + '<main class="menu-content">' + gate + content + '</main><nav class="menu-nav" aria-label="Главное меню">' + navButton('play', icon('play'), 'Играть') + navButton('fleet', icon('plane'), 'Самолёты') + navButton('modifiers', icon('cards'), 'Модификаторы') + navButton('skills', icon('layers'), 'Навыки') + navButton('tasks', icon('tasks'), 'Задачи') + navButton('store', icon('store'), 'Магазин') + navButton('settings', icon('settings'), 'Настройки') + '</nav>' + (!connected ? '<div class="connection-warning">Восстанавливаем соединение…</div>' : '') + '</div>' + (bossOffer ? renderModifierReward(p, bossOffer) : '');
  const contentElement = document.querySelector('.menu-content'); if (contentElement) contentElement.scrollTop = scrollTop;
  mountCareerSlider();
}
function renderQueue() {
  destroyCareerSlider();
  app.innerHTML = '<div class="shade"><section class="queue-panel"><span class="eyebrow">ВОЗДУШНАЯ ДУЭЛЬ</span><h1>Поиск соперника</h1><div class="radar"><i></i><span>' + icon('plane') + '</span></div><div class="queue-time"><b id="queue-seconds">0</b><span>сек</span></div><p id="queue-hint">Ищем игрока</p><label class="bot-option"><input id="allow-bots" type="checkbox" ' + (p!.allowBots ? 'checked' : '') + '> Разрешить ботов</label><p class="muted">Бот через 15 секунд, если игрок не найдётся.</p><button class="button" data-action="queue-bot" ' + (!p!.allowBots ? 'hidden' : '') + '>Сразу в бой с ботом ' + icon('duel') + '</button><button class="plain" data-action="cancel">Назад</button></section></div>';
}
function renderBattle() {
  if (!battle) return;
  destroyCareerSlider();
  scene.active = true; document.body.classList.add('in-flight'); document.body.classList.toggle('touch-flight', touchDevice());
  syncAudio();
  app.innerHTML = '<div class="battle-hud"><div class="battle-top"><div class="hud-plane" aria-label="Прочность самолёта"><b id="hp-text">' + icon('armor') + ' <span id="hp-value"></span></b><div class="meter hp"><i id="hp-bar"></i></div></div><div class="battle-title"><b id="mode-title"></b><small id="mode-subtitle"></small></div><div class="hud-actions"><span id="duel-score" class="duel-score" hidden><b id="duel-score-value"></b><small id="duel-time"></small></span><button class="hud-button" data-action="pause" aria-label="Пауза">' + icon('pause') + '</button></div></div><div class="level-progress"><i id="level-bar"></i></div><div id="boss-hud"></div><div class="battle-bottom"><div class="instrument" title="Нагрев оружия" aria-label="Нагрев оружия">' + icon('heat') + '<div class="meter heat"><i id="heat-bar"></i></div></div><div class="instrument" title="Запас форсажа" aria-label="Запас форсажа">' + icon('boost') + '<div class="meter energy"><i id="energy-bar"></i></div></div></div><small id="mission-status" class="mission-status" hidden></small><div class="touch-controls"><div><button class="flight-stick" data-joystick aria-label="Круговой контрол управления"><span class="stick-directions" aria-hidden="true">↕</span><span class="stick-knob"></span></button></div><div><button class="boost-control" data-control="boost" aria-label="Форсаж">' + icon('boost') + '</button><button class="fire-control" data-control="fire" aria-label="Стрелять">' + icon('target') + '</button></div></div><div id="battle-overlay"></div></div>';
  app.insertAdjacentHTML('beforeend', '<div id="career-overlay"></div>');
  document.querySelector('.boost-control')?.insertAdjacentHTML('beforebegin','<button class="skill-control" data-control="skill" aria-label="Фазовый проход" hidden>ФАЗА · E</button>');
  updateHud();
}
function updateHud() {
  if (!battle) return;
  debug?.update(p, battle, !!lesson);
  syncAudio();
  const me = battle.planes.find(x => x.id === you); if (!me) return;
  const setText = (id: string, value: string) => { const el = document.getElementById(id); if (el && el.textContent !== value) el.textContent = value; };
  const bar = (id: string, v: number) => { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, v * 100)) + '%'; };
  setText('hp-value', Math.max(0, Math.ceil(me.health)) + ' / ' + Math.round(me.hp)); bar('hp-bar', me.health / me.hp); bar('heat-bar', me.heat); bar('energy-bar', me.energy);
  const vertical = battle.mode === 'pve' && battle.phase === 'flight';
  const stick = document.querySelector('.flight-stick'); stick?.setAttribute('aria-label', vertical ? 'Круговой контрол: вверх, вниз, вперёд и назад' : 'Круговой контрол: направление полёта');
  const directions = document.querySelector('.stick-directions'); if (directions) directions.textContent = vertical ? '✥' : '↻';
  const def = ZONE[battle.level - 1], enemy = battle.planes.find(x => x.id !== you);
  const operation = battle.operation, mission = operationMission(battle.level, operation?.completed ?? 0);
  setText('mode-title', lesson ? 'ТРЕНИРОВКА' : battle.mode === 'pve' ? (battle.phase === 'boss' || battle.phase === 'boss-intro' ? def.boss!.name + ' · ' + (battle.bossAttempt ?? 1) + '/3' : 'ОПЕРАЦИЯ ' + battle.level + ' · ВЫЛЕТ ' + Math.min(operationPlan(battle.level).sorties, (operation?.completed ?? 0) + 1) + '/' + operationPlan(battle.level).sorties) : 'ВОЗДУШНАЯ ДУЭЛЬ');
  const subtitle = document.getElementById('mode-subtitle');
  if (subtitle) { subtitle.hidden = false; subtitle.textContent = lesson ? 'БЕЗОПАСНЫЙ ПОЛЁТ' : battle.mode === 'pve' && battle.phase === 'flight' && operation ? mission.title + ' · ' + missionProgress(operation, mission) : battle.mode === 'pve' ? def.name : (enemy?.bot ? 'БОТ · КУРСАНТ' : 'ОНЛАЙН · ИГРОК') + ' · ' + Math.max(0, Math.ceil(120 - battle.time)) + ' сек'; subtitle.title = mission.brief; }
  const introKey = battle.id + ':' + battle.phase + ':' + battle.level + ':' + (operation?.completed ?? 0);
  if (introKey !== hudIntroKey) { hudIntroKey = introKey; hudIntroAt = battle.time; }
  document.querySelector('.battle-title')?.classList.toggle('intro-hidden', battle.time - hudIntroAt >= 6);
  const score = document.getElementById('duel-score'); if (score) { score.hidden = !!lesson || battle.mode !== 'duel'; setText('duel-score-value', me.score + ' : ' + (enemy?.score ?? 0)); const remaining = Math.max(0, Math.ceil(120 - battle.time)); setText('duel-time', (enemy?.bot ? 'БОТ · ' : '') + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0')); score.setAttribute('aria-label', 'Счёт ' + me.score + ' : ' + (enemy?.score ?? 0) + ', осталось ' + remaining + ' секунд'); }
  const objective = document.getElementById('mission-status'); if (objective) { objective.hidden = !!lesson || battle.mode !== 'pve' || battle.phase !== 'flight'; objective.textContent = operation ? missionProgress(operation, mission) : ''; }
  document.querySelector('.instrument')?.classList.toggle('overheated', me.overheated);
  bar('level-bar', battle.mode === 'pve' ? (operation?.seconds ?? 0) / mission.seconds : battle.time / 120);
  const skillButton = document.querySelector<HTMLButtonElement>('[data-control="skill"]'); if (skillButton) { skillButton.hidden = !me.phaseSkill; skillButton.disabled = !!me.phaseCooldown && !me.phaseSeconds; skillButton.textContent = me.phaseSeconds ? 'ФАЗА ' + me.phaseSeconds.toFixed(1) : me.phaseCooldown ? Math.ceil(me.phaseCooldown) + 'с' : 'ФАЗА · E'; }
  const boss = document.getElementById('boss-hud'); if (boss) boss.innerHTML = battle.phase === 'boss' ? '<div class="boss-meter"><i style="width:' + Math.max(0, enemy!.health / enemy!.hp * 100) + '%"></i></div><span>' + Math.max(0, Math.ceil(enemy!.health)) + ' / ' + Math.round(enemy!.hp) + '</span>' : '';
  const phase = ['boss-intro', 'reward', 'sortie-reward'].includes(battle.phase) ? battle.phase + ':' + (bossOffer?.id ?? '') : battle.paused ? 'paused' : battle.phase;
  if (phase !== lastPhase) { lastPhase = phase; renderOverlay(); }
  if (battle.phase === 'ended' && !finished) { finished = true; clearControls(); platform.gameplay(false); scene.audio.play('reward'); }
}
function renderOverlay() {
  if (!battle) return;
  const careerModal = battle.phase === 'boss-intro' || battle.phase === 'reward' || battle.phase === 'sortie-reward' || battle.mode === 'pve' && battle.phase === 'ended';
  const el = document.getElementById(careerModal ? 'career-overlay' : 'battle-overlay'); if (!el) return;
  const other = document.getElementById(careerModal ? 'battle-overlay' : 'career-overlay'); if (other) other.innerHTML = '';
  if (lesson && !battle.paused) { renderLesson(); return; }
  if (battle.phase === 'sortie-reward') {
    const completed = battle.operation!.completed, next = operationMission(battle.level, completed);
    const budget=sortieReward(battle.level), multiplier=battle.planes[0].rewardMultiplier ?? 1;
    const silver=Math.max(battle.operation?.killSilver ?? 0,combatReward(campaignReward(budget.silver),multiplier));
    const xp=Math.max(battle.operation?.killXp ?? 0,combatReward(campaignReward(budget.xp),multiplier));
    el.innerHTML = '<div class="shade career-shade"><section class="result-panel sortie-summary" role="dialog" aria-modal="true"><span class="eyebrow">ВЫЛЕТ ВЫПОЛНЕН · ' + completed + '/' + operationPlan(battle.level).sorties + '</span><h1>Следующий вылет: ' + next.title + '</h1><p>' + next.brief + '</p><small>Доход этого вылета: ' + money(silver) + ' серебра · ' + money(xp) + ' опыта. Награды за уничтожения уже учтены.</small><small>Завершённые вылеты сохранены. Перед следующим самолёт полностью отремонтируют.</small><button class="button" data-action="sortie-next">Следующий вылет</button><button class="plain" data-action="boss-hangar">В ангар · улучшить самолёт</button></section></div>';
    return;
  }
  if (battle.phase === 'boss-intro') {
    const boss = bossBalance(battle.level), stage = careerStage(battle.level);
    el.innerHTML = '<div class="shade career-shade"><section class="boss-intro-panel" role="dialog" aria-modal="true" aria-labelledby="boss-title"><div class="boss-intro-art"><span class="boss-stage-tag">ЭТАП ' + stage.number + ' · УРОВЕНЬ ' + battle.level + '</span><canvas data-aircraft="' + bossAircraft(battle.level) + '" width="400" height="200" role="img" aria-label="Самолёт босса ' + boss.name + '"></canvas><span class="boss-intro-seal">' + icon('target') + '</span></div><div class="boss-intro-copy"><span class="collection-kicker">ВЫ ДОШЛИ ДО БОССА</span><h1 id="boss-title">' + boss.name + '</h1><p>Полёт на паузе. Подготовьте самолёт в ангаре или вступите в бой сейчас.</p><div class="boss-intro-specs"><span>' + icon('armor') + '<b>' + boss.hp + '</b> HP</span><span>' + icon('cards') + 'Модификатор за победу</span></div><p class="boss-attempt-note">Попытка ' + (battle.bossAttempt ?? 1) + ' из 3. После трёх поражений — возврат к уровню ' + stage.start + '. Ваши модификаторы сохранятся.</p><div class="boss-intro-actions"><button class="button" data-action="boss-start">В бой ' + icon('duel') + '</button><button class="button subtle" data-action="boss-hangar">' + icon('hangar') + ' В ангар</button></div><small>Возвращение из ангара не тратит попытку.</small></div></section></div>';
    return;
  }
  if (battle.phase === 'reward') { el.innerHTML = p && bossOffer ? renderModifierReward(p, bossOffer) : '<div class="shade"><p>Сохраняем победу…</p></div>'; return; }
  if (battle.phase === 'ended') {
    const me = battle.planes.find(x => x.id === you)!, e = battle.earned[you], duel = battle.mode === 'duel';
    const enemy = battle.planes.find(x => x.id !== you), win = duel && me.score > (enemy?.score ?? 0);
    el.innerHTML = '<div class="shade"><section class="result-panel"><span class="result-symbol">' + (win || battle.level === ZONE.length && me.health > 0 ? '' + icon('trophy') + '' : '' + icon('plane') + '') + '</span><span class="eyebrow">' + (duel ? 'ДУЭЛЬ ЗАВЕРШЕНА' : 'КОНЕЦ ВЫЛЕТА · УРОВЕНЬ ' + battle.level) + '</span><h1>' + (duel && battle.result === 'Дуэль завершена' ? win ? 'Победа!' : 'Поражение' : battle.result) + '</h1>' + (battle.bossAttemptsExhausted ? '<p class="stage-reset-note">Возврат к началу этапа ' + careerStage(battle.level).number + ' · уровень ' + battle.restartLevel + '. Самолёты, улучшения и модификаторы сохранены.</p>' : '') + '<div class="result-loot"><b class="silver">' + icon('silver') + ' ' + money(e?.silver ?? 0) + '</b><b class="xp">+' + money(e?.xp ?? 0) + ' XP</b></div><button class="button" data-action="home">Главный экран ' + icon('arrow') + '</button>' + (!duel && me.health <= 0 ? '<button class="plain" data-action="retry">' + (battle.bossAttemptsExhausted ? 'С начала этапа · уровень ' + battle.restartLevel : battle.planes.some(p => p.id === 'boss') ? 'Повторить босса · осталось ' + (3 - (battle.bossAttempt ?? 1)) : 'Повторить уровень ' + battle.level) + '</button>' : '') + '</section></div>';
  } else if (battle.paused) el.innerHTML = '<div class="shade"><section class="result-panel"><h1>Пауза</h1><p>' + (lesson ? 'Продолжите обучение, когда будете готовы.' : 'Полёт сохранён.') + '</p><button class="button" data-action="resume">Продолжить ' + icon('arrow') + '</button><button class="plain" data-action="home">Главный экран</button></section></div>';
  else el.innerHTML = '';
}
function setPause(reason: string, value: boolean) {
  const onlineDuel = !lesson && battle?.mode === 'duel' && battle.planes.every(x => !x.bot);
  if (onlineDuel && reason === 'manual') { toast('Онлайн-дуэль продолжается; пауза пока доступна только против ИИ'); return; }
  if (value) pauseReasons.add(reason); else pauseReasons.delete(reason);
  syncAudio();
  clearControls(); if (!lesson) send({ type: 'input', turn: 0, fire: false, boost: false });
  if (!battle || battle.phase === 'ended') return;
  if (onlineDuel) return;
  if (lesson) { battle.paused = pauseReasons.size > 0; scene.accept(structuredClone(battle), you); renderOverlay(); return; }
  send({ type: 'pause', paused: pauseReasons.size > 0 });
  platform.gameplay(pauseReasons.size === 0 && !['boss-intro', 'reward', 'sortie-reward'].includes(battle.phase));
}
function home(destination = 'play') { const training = !!lesson; if (!training || lessonBoss) send({type:'leave'}); lesson = undefined; afterLesson = undefined; lessonBoss = undefined; tab = destination; if (destination === 'fleet') inspectedPlane = p?.selected ?? ''; battle = undefined; finished = false; pauseReasons.clear(); clearControls(); syncOrientation(); renderMenu(); }
document.addEventListener('click', e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('button, a'); if (!target) return;
  scene.audio.unlock();
  if (target.dataset.modifierFilter) { modifierFilter = target.dataset.modifierFilter as 'all' | 'owned'; renderMenu(); return; }
  if (target.dataset.modifier && bossOffer && !choosingModifier) {
    choosingModifier = true; clearControls();
    document.querySelectorAll<HTMLButtonElement>('[data-modifier]').forEach(button => button.disabled = true);
    void rpc('modifier-choose', {offerId: bossOffer.id, id: target.dataset.modifier, paused: pauseReasons.size > 0})
      .then(() => { toast('Модификатор сохранён в вашей карьере'); scene.audio.play('reward'); })
      .catch(error => toast(error.message || 'Не удалось сохранить выбор'))
      .finally(() => { choosingModifier = false; if (battle) renderOverlay(); else renderMenu(true); });
    return;
  }
  if (target.dataset.tab) { e.preventDefault(); tab = target.dataset.tab; if (tab === 'fleet') inspectedPlane = p?.selected ?? ''; if (tab === 'modifiers') modifierFilter = 'owned'; renderMenu(); if (tab === 'tasks') send({ type: 'refresh' }); scene.audio.play('click'); return; }
  if (target.dataset.inspect) { inspectedPlane = target.dataset.inspect; if (p?.owned.includes(inspectedPlane) && p.selected !== inspectedPlane) send({ type: 'select', id: inspectedPlane }); else renderMenu(); return; }
  if (target.dataset.select) send({ type: 'select', id: target.dataset.select });
  if (target.dataset.buy) {
    const model = PLANES.find(x => x.id === target.dataset.buy)!;
    if (model.currency === 'gold') confirmTrade({ type: 'buy', id: model.id }, model.name, 'Самолёт навсегда · списать золото: ' + model.price);
    else spend({ type: 'buy', id: model.id });
  }
  if (target.dataset.moduleBuy) { const module = MODULES.find(x => x.id === target.dataset.moduleBuy)!; const model = PLANES.find(x => x.id === target.dataset.model)!; confirmTrade({ type: 'module-buy', id: module.id, model: model.id }, module.name + ' для ' + model.name, 'Модуль только для этого самолёта · списать золото: ' + module.price); }
  if (target.dataset.moduleEquip !== undefined) send({ type: 'module-equip', id: target.dataset.moduleEquip, model: target.dataset.model });
  if (target.dataset.exchange) { const amount = Number(target.dataset.exchange), currency = target.dataset.currency!; confirmTrade({ type: 'exchange', amount, currency }, 'Обмен золота', 'Списать золото: ' + amount + ' на ' + (currency === 'silver' ? 'серебро: ' + amount * 25 : amount * 8 + ' опыта') + '. Обмен необратим.'); }
  if (target.dataset.pack) void platform.purchase(target.dataset.pack, rpc).then(() => toast('Покупка получена и сохранена')).catch(error => toast(error.message || 'Покупка не завершена'));
  if (target.dataset.research) spend({type:'research', branch:target.dataset.research, level:Number(target.dataset.level)});
  if (target.dataset.upgrade) spend({ type: 'upgrade', branch: target.dataset.upgrade, level:Number(target.dataset.level) });
  if (target.dataset.phoenixPart && p) {
    const part = phoenixPartRequirements(p, target.dataset.phoenixPart as Upgrade, Number(target.dataset.level));
    if (part.canBuy) confirmTrade({type:'phoenix-part', branch:target.dataset.phoenixPart, level:part.level}, 'Установить золотую деталь?', 'Стоимость: ' + part.price + ' золота. Усиление только для Феникса. Опыт и серебро не расходуются.');
  }
  if (target.dataset.skillBuy) spend({type:'skill-buy', id:target.dataset.skillBuy});
  if (target.dataset.claim) send({ type: 'claim', id: target.dataset.claim, period: target.dataset.period, key: target.dataset.key });
  switch (target.dataset.action) {
    case 'boss-start': startBossWithLesson(); break;
    case 'sortie-next': target.setAttribute('disabled',''); void rpc('sortie-next', {paused:pauseReasons.size > 0}).catch(error => { target.removeAttribute('disabled'); toast(error.message); }); break;
    case 'boss-hangar': home('fleet'); break;
    case 'boss-return': send({type:'pve',resume:true}); break;
    case 'queue': beginLesson('duel'); break;
    case 'queue-bot': if (queueStarted && p?.allowBots) send({type:'queue-bot'}); break;
    case 'pve': beginLesson('pve'); break;
    case 'touch-setting': forceTouch = !forceTouch; localStorage.setItem('biplanes-touch-controls', forceTouch ? '1' : '0'); renderMenu(true); break;
    case 'tutorial-pve': beginLesson('pve', true); break;
    case 'tutorial-duel': beginLesson('duel', true); break;
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
document.addEventListener('change', e => { const input = e.target as HTMLInputElement; if (input.id === 'allow-bots') { p!.allowBots = input.checked; send({ type: 'bots', allowed: input.checked }); const button = document.querySelector<HTMLButtonElement>('[data-action="queue-bot"]'); if (button) button.hidden = !input.checked; } });
document.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).closest('#debug-panel') || e.code === 'F2') return;
  if (!lesson && e.code === 'Tab') {
    const modal = app.querySelector<HTMLElement>('[aria-modal="true"]');
    const focusable = modal?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)');
    if (focusable?.length) {
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !modal!.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !modal!.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }
  if (!battle || battle.phase === 'ended') return;
  if (battle.phase === 'boss-intro' || battle.phase === 'reward' || battle.phase === 'sortie-reward') return;
  if (lesson && e.code === 'Tab' && !battle.paused) { e.preventDefault(); return; }
  if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyE', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' && !e.repeat) setPause('manual', !pauseReasons.has('manual'));
  keys.add(e.code); scene.audio.unlock();
  if (e.code === 'KeyE' && !e.repeat && battle.mode === 'pve' && !battle.paused && !pauseReasons.size) skillPulseFrames = 2;
  if (!e.repeat && lesson && !battle.paused && !pauseReasons.size) lesson.trigger(currentControls());
});
document.addEventListener('keyup', e => keys.delete(e.code));
document.addEventListener('pointerdown', e => {
  const stick = (e.target as HTMLElement).closest<HTMLElement>('[data-joystick]');
  if (stick) { if (stickPointer !== undefined) return; e.preventDefault(); stick.setPointerCapture(e.pointerId); stickPointer = e.pointerId; moveStick(e); scene.audio.unlock(); return; }
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-control]'); if (!button) return;
  if (button.hasAttribute('disabled')) return;
  e.preventDefault(); button.setPointerCapture(e.pointerId); touches.set(e.pointerId, button.dataset.control!); button.classList.add('pressed'); scene.audio.unlock();
  if (button.dataset.control === 'skill' && battle?.mode === 'pve' && !battle.paused && !pauseReasons.size) skillPulseFrames = 2;
  if (lesson && !battle?.paused && !pauseReasons.size) lesson.trigger(currentControls());
});
function moveStick(e: PointerEvent) {
  if (stickPointer !== e.pointerId) return;
  const stick = document.querySelector<HTMLElement>('.flight-stick'); if (!stick) return;
  const r = stick.getBoundingClientRect(), radius = r.width / 2;
  const x = (e.clientX - r.left - radius) / radius, y = (e.clientY - r.top - r.height / 2) / radius, length = Math.max(1, Math.hypot(x, y));
  stickX = x / length; stickY = y / length;
  if (lesson && !battle?.paused && !pauseReasons.size && Math.abs(stickY) >= .2) lesson.trigger({ turn: Math.sign(stickY), fire: false, boost: false });
  stick.querySelector<HTMLElement>('.stick-knob')!.style.transform = `translate(${stickX * radius * .55}px,${stickY * radius * .55}px)`;
}
document.addEventListener('pointermove', moveStick);
function releasePointer(e: PointerEvent) {
  if (stickPointer === e.pointerId) { stickPointer = undefined; stickX = stickY = 0; document.querySelector<HTMLElement>('.stick-knob')?.style.setProperty('transform', 'translate(0,0)'); }
 touches.delete(e.pointerId); (e.target as HTMLElement).closest('[data-control]')?.classList.remove('pressed'); }
document.addEventListener('pointerup', releasePointer); document.addEventListener('pointercancel', releasePointer); document.addEventListener('lostpointercapture', releasePointer);
window.addEventListener('blur', () => setPause('focus', true)); window.addEventListener('focus', () => setPause('focus', false));
document.addEventListener('visibilitychange', () => setPause('hidden', document.hidden));
document.addEventListener('contextmenu', e => e.preventDefault());
setInterval(() => {
  if (queueStarted) { const seconds = Math.floor((Date.now() - queueStarted) / 1000); const counter = document.getElementById('queue-seconds'), hint = document.getElementById('queue-hint'); if (counter) counter.textContent = '' + seconds; if (hint) hint.textContent = seconds < 15 ? 'Ищем пилота близкого ранга' : p?.allowBots ? 'Готовим бой с ботом…' : 'Продолжаем искать игрока'; }
  if (!battle || ['ended', 'boss-intro', 'reward', 'sortie-reward'].includes(battle.phase) || battle.paused || pauseReasons.size) return;
  if (!lesson) { send({ type: 'input', ...currentControls() }); skillPulseFrames = Math.max(0, skillPulseFrames - 1); }
}, 1000 / 30);
function currentControls() {
  const input = flightControls(battle!, keys, new Set(touches.values()));
  if (battle!.mode === 'pve' && skillPulseFrames) input.skill = true;
  if (stickPointer !== undefined) {
    const flight = battle!.mode === 'pve' && battle!.phase === 'flight';
    input.turn = joystickTurn(flight, battle!.planes.find(p => p.id === you)!.angle, stickX, stickY);
    if (flight) input.horizontal = joystickHorizontal(stickX);
  }
  return input;
}
let lessonFrame = performance.now();
function tickLesson(now: number) {
  const dt = Math.min(.04, (now - lessonFrame) / 1000); lessonFrame = now;
  if (lesson && battle && !battle.paused && !pauseReasons.size && !document.hidden) {
    const raw = lesson.demonstrating ? lessonInput(lesson.step) : currentControls();
    const input = { turn: lesson.step === 1 || lesson.step === 2 ? raw.turn : 0, fire: lesson.step === 3 && raw.fire, boost: lesson.step === 4 && raw.boost };
    // Freeze between instructions; no obstacles, damage, economy or online opponent.
    if (lesson.step > 0 && lesson.step < 5) stepTrainingBattle(battle, you, input, dt);
    const progressInput = stickPointer !== undefined && !lesson.demonstrating && (lesson.step === 1 || lesson.step === 2) ? { ...input, turn: Math.abs(stickY) >= .2 ? Math.sign(stickY) : 0 } : input;
    if (lesson.tick(progressInput, dt)) {
      clearControls();
      if (lesson.step === 5) { finishLesson(); requestAnimationFrame(tickLesson); return; }
      renderLesson();
    }

    scene.accept(structuredClone(battle), you); updateHud(); positionLesson();
  }
  requestAnimationFrame(tickLesson);
}
requestAnimationFrame(tickLesson);
function connect() {
  const endpoint = import.meta.env.VITE_SERVER_URL || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/socket';
  ws = new WebSocket(endpoint);
  ws.onopen = () => { connected = true; loading.stage('Загружаем профиль пилота…', 90); send({ type: 'auth', token: platform.getToken() }); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'welcome') {
      debug?.setEnabled(m.debugEnabled === true);
      localStorage.setItem('biplanes-token', m.token); you = m.you; paymentsEnabled = m.paymentsEnabled;
      void platform.rememberToken(m.token).then(() => { if (paymentsEnabled) return platform.recover(rpc); }).catch(error => toast(error.message || 'Не удалось сохранить ангар в облаке'));
    }
    if (m.type === 'reply') { const pending = rpcWaiters.get(m.requestId); if (pending) { rpcWaiters.delete(m.requestId); clearTimeout(pending.timer); if (m.ok) pending.resolve(m.result); else pending.reject(new Error(m.error)); } }
    if (m.type === 'profile') {
      const previous = p; p = m.profile; resume = m.resume; restartLevel = m.restartLevel; operationCompleted = m.operationCompleted ?? 0; bossOffer = m.bossOffer; bossGateLevel = m.bossGateLevel;
      if (!battle && !queueStarted) {
        renderMenu(true);
        if (previous && previous.id === p!.id) {
          if (pilotRank(p!) > pilotRank(previous)) { toast('Новый ранг: ' + pilotRank(p!) + '!'); scene.audio.play('reward'); }
          else if (p!.gold > previous.gold) { toast('Получено ' + (p!.gold - previous.gold) + ' золота'); scene.audio.play('reward'); }
          else if (p!.silver > previous.silver) { toast('Получено: ' + (p!.silver - previous.silver) + ' серебра и ' + (p!.xp - previous.xp) + ' опыта'); scene.audio.play('reward'); }
          else if (p!.skills?.phase && !previous.skills?.phase) { toast('Фазовый проход открыт · E или кнопка в бою'); scene.audio.play('reward'); }
          else if (p!.xp < previous.xp) { toast('Исследовано · теперь купите за серебро'); scene.audio.play('reward'); }
          else if (p!.silver < previous.silver) { toast('Самолёт готов к новым вылетам'); scene.audio.play('reward'); }
        }
      }
      if (battle?.phase === 'reward') renderOverlay();
      loading.finish(() => platform.markReady());
    }
    if (m.type === 'queued') { queueStarted = Date.now(); renderQueue(); }
    if (m.type === 'cancelled') { queueStarted = 0; renderMenu(); }
    if (m.type === 'start') { battle = m.battle; you = m.you; queueStarted = 0; finished = false; lastPhase = ''; pauseReasons.clear(); if (debug?.isOpen) { pauseReasons.add('debug'); send({type:'pause',paused:true}); } clearControls(); renderBattle(); scene.accept(battle!, you); platform.gameplay(!battle!.paused && !['ended', 'boss-intro', 'reward', 'sortie-reward'].includes(battle!.phase)); syncOrientation(); }
    if (m.type === 'state' && battle?.id === m.battle.id) { battle = m.battle; scene.accept(battle!, you); updateHud(); platform.gameplay(!battle!.paused && !['ended', 'boss-intro', 'reward', 'sortie-reward'].includes(battle!.phase)); }
    if (m.type === 'error') toast(m.message);
  };
  ws.onclose = e => {
    for (const item of rpcWaiters.values()) { clearTimeout(item.timer); item.reject(new Error('Связь прервалась. Покупки восстановятся при входе.')); } rpcWaiters.clear();
    if (swapAccount) { swapAccount = false; return; }
    if (!p) loading.fail('Нет связи с ангаром. Проверьте соединение или повторите загрузку.');
    connected = false; queueStarted = 0; lesson = undefined; afterLesson = undefined; lessonBoss = undefined; battle = undefined; pauseReasons.clear(); clearControls(); scene.active = false; platform.gameplay(false); syncOrientation(); renderMenu(); toast(e.reason || 'Связь прервалась. Переподключаемся…'); if (e.code !== 1008) setTimeout(connect, 2000);
  };
}
scene.onLoadProgress = progress => loading.stage('Загружаем самолёты и небо…', progress * 65);
scene.onLoadError = () => loading.fail('Не удалось загрузить самолёты. Повторите загрузку.');
scene.onReady = () => { if (!started) { started = true; loading.stage('Подключаем платформу…', 72); renderMenu(); void platform.init(value => setPause('platform', value)).then(() => { loading.stage('Соединяемся с ангаром…', 82); connect(); }); } };
platform.onChange = () => { if (p && !battle && !queueStarted) renderMenu(true); };
window.addEventListener('resize', syncOrientation);
matchMedia('(pointer: coarse)').addEventListener('change', syncOrientation);
syncOrientation();
