import { GOLD_PACKS, MODULES, PLANES, Profile, Upgrade, planeStats, researchLevel, researchXp, upgradeLevel, MAX_UPGRADE_LEVEL, upgradeSilver, planeUnlocked, planeLockedReason, CAREER_STAGES, careerStage, ZONE } from '../shared/data';
import { operationPlan } from '../shared/operations';
import { PHASE_SKILL } from '../shared/skills';
import { icon, IconName } from './icons';
import { hasPremium, PREMIUM_PRODUCT_ID } from '../shared/premium';

const money = (n: number) => Math.floor(n).toLocaleString('ru-RU');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]!));
const aircraft = (id: string, cls = '') => '<canvas class="' + cls + '" data-aircraft="' + id + '" width="400" height="200" role="img" aria-label="' + PLANES.find(x => x.id === id)!.name + '"></canvas>';

export function renderLobby(p: Profile, resume: boolean, level: number, completed = 0) {
  const model = PLANES.find(x => x.id === p.selected)!;
  const stage = careerStage(level);
  return '<section class="launch-screen" aria-label="Выбор режима">' +
    '<button class="launch-aircraft" data-tab="fleet" aria-label="Сменить самолёт: ' + model.name + '">' + aircraft(model.id) + '<span><b>' + model.name + '</b><small>Сменить самолёт ' + icon('arrow') + '</small></span></button>' +
    '<div class="launch-modes"><button class="launch-mode campaign" data-action="pve" aria-label="Играть: Кампания"><span class="mode-mark">' + icon('route') + '</span><strong>Кампания</strong><small>Уровень ' + level + ' / ' + ZONE.length + ' · вылеты ' + Math.min(completed, operationPlan(level).sorties) + '/' + operationPlan(level).sorties + '</small><span class="launch-cta">' + (resume ? 'Продолжить' : 'Играть') + icon('arrow') + '</span></button>' +
    '<button class="launch-mode versus" data-action="queue" aria-label="Играть: Один на один"><span class="mode-mark">' + icon('duel') + '</span><strong>Один на один</strong><small>Дуэль</small><span class="launch-cta">Играть' + icon('arrow') + '</span></button></div><div class="career-route" aria-label="Этапы карьеры">' + CAREER_STAGES.map(s => '<span class="career-stage ' + (stage.number === s.number ? 'current' : s.number < stage.number ? 'complete' : '') + '"><i>' + (s.number < stage.number ? '✓' : s.number) + '</i><span>Уровни <b>' + s.start + '–' + s.end + '</b></span></span>').join('') + '</div><button class="flight-help" data-tab="help">' + icon('help') + '<span>Как летать</span>' + icon('arrow') + '</button></section>';
}

export function renderHangar(p: Profile, inspected: string) {
  const model = PLANES.find(x => x.id === inspected) ?? PLANES.find(x => x.id === p.selected)!;
  const owned = p.owned.includes(model.id), selected = p.selected === model.id;
  const stats = planeStats({ ...p, selected: model.id });
  const priceIcon = model.currency === 'gold' ? 'gold' : 'silver';
  const bossLocked = !planeUnlocked(p, model), affordable = p[model.currency] >= model.price;
  const collection = PLANES.map(plane => {
    const has = p.owned.includes(plane.id), active = p.selected === plane.id;
    return '<button class="aircraft-pick ' + (plane.id === model.id ? 'viewed' : '') + '" data-inspect="' + plane.id + '" aria-pressed="' + (plane.id === model.id) + '" aria-label="' + (has ? 'Выбрать и настроить ' : 'Посмотреть ') + plane.name + '">' + aircraft(plane.id) + '<b>' + plane.name + '</b><small>' + (has ? active ? icon('check') + ' Выбран' : 'В ангаре' : '<span class="' + plane.currency + '">' + icon(plane.currency === 'gold' ? 'gold' : 'silver') + ' ' + money(plane.price) + '</span>') + '</small></button>';
  }).join('');
  const specs: [IconName, string, string][] = [['armor', 'Прочность', Math.round(stats.hp) + ' HP'], ['engine', 'Скорость', Math.round(stats.speed) + ''], ['turnRight', 'Манёвр', Math.round(stats.turn * 180 / Math.PI) + '°/с'], ['target', 'Урон', stats.damage.toFixed(1).replace('.0', '')]];
  const current = planeStats(p), compared = [stats.hp/current.hp,stats.speed/current.speed,stats.turn/current.turn,stats.damage/current.damage];
  const branches: [Upgrade, IconName, string, string][] = [['hull', 'armor', 'Броня', '+2% прочности за ступень · до +30%'], ['engine', 'engine', 'Двигатель', 'До +10% скорости и +5% манёвра'], ['gun', 'target', 'Вооружение', '+2% урона за ступень · до +30%']];
  const improvements = branches.map(([branch, symbol, name, detail]) => {
    const n = upgradeLevel(p, model.id, branch), level = n + 1, cost = upgradeSilver(level, model.id), xp = researchXp(level, model.id);
    const researched = researchLevel(p, model.id, branch) >= level;
    const locked = !owned || !selected || n >= MAX_UPGRADE_LEVEL || (researched ? p.silver < cost : p.xp < xp);
    const action = n >= MAX_UPGRADE_LEVEL ? 'Максимум' : researched ? '<span class="silver">' + icon('silver') + ' ' + money(cost) + '</span> · Купить' : '<span class="xp">' + xp + ' XP</span> · Исследовать';
    return '<section class="improvement"><span class="improvement-icon">' + icon(symbol) + '</span><div><h3>' + name + '</h3><small>' + detail + '</small></div><span class="upgrade-level">' + n + '/' + MAX_UPGRADE_LEVEL + '</span><div class="upgrade-steps" aria-hidden="true">' + Array.from({length:MAX_UPGRADE_LEVEL}, (_,i) => '<i class="' + (i<n?'filled':'') + '"></i>').join('') + '</div><button class="button" data-' + (researched?'upgrade':'research') + '="' + branch + '" data-level="' + level + '" ' + (locked?'disabled':'') + '>' + action + '</button>' + (n<MAX_UPGRADE_LEVEL?'<span class="upgrade-price">' + (researched?'Исследовано · осталось купить':'Затем <span class="silver">' + icon('silver') + ' ' + money(cost) + '</span>') + '</span>':'') + '</section>';
  }).join('');
  const equipment = MODULES.map(module => {
    const has = p.modules.includes(module.id), active = p.module === module.id;
    return '<section class="equipment-card ' + (active ? 'equipped' : '') + '"><span class="equipment-icon">' + icon(module.id === 'carburetor' ? 'engine' : 'cooling') + '</span><div><h3>' + module.name + '</h3><p>' + module.detail + '</p></div><button class="button ' + (has ? 'subtle' : 'gold-button') + '" data-' + (has ? 'module-equip' : 'module-buy') + '="' + (active ? '' : module.id) + '" ' + (!has && p.gold < module.price ? 'disabled' : '') + '>' + (has ? active ? icon('check') + ' Снять' : 'Установить' : '<span class="gold">' + icon('gold') + ' ' + module.price + '</span> · Купить') + '</button></section>';
  }).join('');
  const skill = p.skills?.phase ? '<p class="skill-owned">' + icon('check') + ' Фазовый проход открыт · E или кнопка в бою</p>' : '<button class="button" data-skill-buy="phase" ' + (!p.defeatedBosses?.includes(10) || p.silver < PHASE_SKILL.silver || p.xp < PHASE_SKILL.xp ? 'disabled' : '') + '>Открыть · 1200 серебра + 300 XP</button>';
  const skills = '<section class="skill-card"><span class="eyebrow">АКТИВНЫЙ НАВЫК · КАМПАНИЯ</span><h3>Фазовый проход</h3><p>2 секунды прохода через скалы, ПВО и самолёты. Перезарядка 35 секунд. Пули и бомбы наносят урон; касание земли остаётся смертельным.</p><small>Один раз открывается после босса 10 и работает на всех самолётах.</small>' + skill + '</section>';
  return '<div class="page-heading"><h1>Самолёты</h1><span class="rank-note xp">Опыт: ' + money(p.xp) + '</span></div><div class="aircraft-collection" aria-label="Самолёты ангара">' + collection + '</div>' +
    '<section class="aircraft-detail"><div class="detail-portrait" style="--plane-color:' + model.color + '">' + aircraft(model.id) + '</div><div class="detail-info"><div class="detail-title"><h2>' + model.name + '</h2><span class="model-badge">' + (model.unlockBoss ? 'Босс ' + model.unlockBoss : 'Стартовый') + '</span></div><p>' + model.role + '</p><div class="aircraft-specs">' + specs.map(([symbol, label, value], i) => '<div>' + icon(symbol) + '<small>' + label + '</small><b>' + value + '</b>' + (!owned ? '<small class="stat-comparison">' + (compared[i]>=1?'+':'') + Math.round((compared[i]-1)*100) + '% к вашему</small>' : '') + '</div>').join('') + '</div>' +
    (owned ? '<button class="button subtle detail-action" data-tab="play">К вылету ' + icon('arrow') + '</button>' : '<button class="button ' + (model.currency === 'gold' ? 'gold-button' : '') + ' detail-action" data-buy="' + model.id + '" ' + (bossLocked || !affordable ? 'disabled' : '') + '>Купить · <span class="' + model.currency + '">' + icon(priceIcon) + ' ' + money(model.price) + '</span></button><small class="purchase-note">' + (bossLocked ? escapeHtml(planeLockedReason(p, model)) : !affordable ? 'Не хватает ' + money(model.price - p[model.currency]) + ' ' + (model.currency === 'gold' ? 'золота' : 'серебра') : 'Самолёт останется в вашем ангаре') + '</small>' + (model.currency === 'gold' && !affordable ? '<button class="plain" data-tab="store">Пополнить золото ' + icon('arrow') + '</button>' : '')) + '</div></section>' +
    (owned ? '<div class="subheading"><h2>Улучшения</h2><span>Исследовать за опыт → купить за серебро</span></div><div class="improvement-grid">' + improvements + '</div><div class="subheading"><h2>Оснащение</h2><span>Один модуль для всех самолётов</span></div><div class="equipment-grid">' + equipment + '</div>' + skills : '<p class="locked-improvements">Улучшения и оснащение доступны после покупки самолёта.</p>');
}

type StoreState = { available: boolean; authorized: boolean; platformAvailable: boolean; products: { id: string; price: string }[] };
export function renderStore(p: Profile, state: StoreState) {
  const premium = state.products.find(product => product.id === PREMIUM_PRODUCT_ID), active = hasPremium(p);
  const premiumCard = '<section class="premium-offer ' + (active ? 'active' : '') + '" aria-label="Премиум-доступ"><span class="premium-emblem">' + icon('trophy') + '</span><div><span class="eyebrow">ПРИВИЛЕГИИ ПИЛОТА · НАВСЕГДА</span><h2>Премиум-доступ</h2><div class="premium-perks"><span class="xp">+50% опыта</span><span class="silver">+50% серебра</span></div><p>Больше наград за бои в кампании и дуэлях. Одна покупка на весь профиль, для любого самолёта.</p><small>Бонус действует на боевые награды. Подарки, задачи и обмен сохраняют свои значения.</small></div><div class="premium-purchase">' + (active ? '<b>' + icon('check') + ' Активен навсегда</b>' : '<button class="button gold-button" data-pack="premium" ' + (!state.available || !premium ? 'disabled' : '') + '>' + (premium ? 'Купить · ' + escapeHtml(premium.price) : 'Пока недоступно') + '</button><small>Без подписки и продления</small>') + '</div></section>';
  const goldCards = GOLD_PACKS.map(pack => {
    const product = state.products.find(x => x.id === pack.id);
    return '<section class="gold-pack"><div>' + icon('gold') + '</div><h2>' + pack.gold + '</h2><small>золота</small><button class="button gold-button" data-pack="' + pack.id + '" ' + (!state.available || !product ? 'disabled' : '') + '>' + (product ? escapeHtml(product.price) : 'Недоступно') + '</button></section>';
  }).join('');
  return '<div class="page-heading"><h1>Магазин</h1></div>' + premiumCard + '<h2 class="store-title">Золото</h2>' + (!state.available ? '<p class="store-notice">Покупки пока недоступны.</p>' : '') +
    (state.platformAvailable && !state.authorized ? '<button class="plain" data-action="authorize">Войти в Яндекс для покупок ' + icon('arrow') + '</button>' : '') +
    '<div class="store-grid">' + goldCards + '</div>' + (state.available ? '<button class="plain" data-action="recover">Восстановить покупки</button>' : '') +
    '<div class="subheading"><h2>Переплавка золота</h2></div><p class="exchange-rate">1 золото = 25 серебра или 8 опыта</p><div class="exchange-grid">' + [10, 50, 100].map(amount => '<section class="exchange-card"><b>' + icon('gold') + ' ' + amount + '</b><button class="plain" data-exchange="' + amount + '" data-currency="silver" ' + (p.gold < amount ? 'disabled' : '') + '>' + icon('arrow') + ' <span class="silver">' + icon('silver') + ' ' + money(amount * 25) + '</span>' + '</button><button class="plain" data-exchange="' + amount + '" data-currency="xp" ' + (p.gold < amount ? 'disabled' : '') + '>' + icon('arrow') + ' ' + amount * 8 + ' опыта</button></section>').join('') + '</div>';
}
