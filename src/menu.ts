import { GOLD_PACKS, MODULES, PLANES, Profile, Upgrade, planeStats, rankOf } from '../shared/data';
import { icon, IconName } from './icons';
import { aircraftAsset } from './aircraft';

const money = (n: number) => Math.floor(n).toLocaleString('ru-RU');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]!));
const aircraft = (id: string, cls = '') => '<img class="' + cls + '" src="' + aircraftAsset(id) + '" alt="' + PLANES.find(x => x.id === id)!.name + '">';

export function renderLobby(p: Profile, resume: boolean, level: number) {
  const model = PLANES.find(x => x.id === p.selected)!;
  return '<section class="launch-screen" aria-label="Выбор режима">' +
    '<button class="launch-aircraft" data-tab="fleet" aria-label="Сменить самолёт: ' + model.name + '">' + aircraft(model.id) + '<span><b>' + model.name + '</b><small>Сменить самолёт ' + icon('arrow') + '</small></span></button>' +
    '<div class="launch-modes"><button class="launch-mode campaign" data-action="pve" aria-label="Играть: Кампания"><span class="mode-mark">' + icon('route') + '</span><strong>Кампания</strong><small>Уровень ' + level + ' / 50</small><span class="launch-cta">' + (resume ? 'Продолжить' : 'Играть') + icon('arrow') + '</span></button>' +
    '<button class="launch-mode versus" data-action="queue" aria-label="Играть: Один на один"><span class="mode-mark">' + icon('duel') + '</span><strong>Один на один</strong><small>Дуэль</small><span class="launch-cta">Играть' + icon('arrow') + '</span></button></div><button class="flight-help" data-tab="help">' + icon('help') + '<span>Как летать</span>' + icon('arrow') + '</button></section>';
}

export function renderHangar(p: Profile, inspected: string) {
  const model = PLANES.find(x => x.id === inspected) ?? PLANES.find(x => x.id === p.selected)!;
  const owned = p.owned.includes(model.id), selected = p.selected === model.id, rank = rankOf(p.xp);
  const stats = planeStats({ ...p, selected: model.id }), upgrades = p.upgrades[model.id] ?? { hull: 0, engine: 0, gun: 0 };
  const priceIcon = model.currency === 'gold' ? 'gold' : 'silver';
  const rankLocked = rank < model.rank, affordable = p[model.currency] >= model.price;
  const collection = PLANES.map(plane => {
    const has = p.owned.includes(plane.id), active = p.selected === plane.id;
    return '<button class="aircraft-pick ' + (plane.id === model.id ? 'viewed' : '') + '" data-inspect="' + plane.id + '" aria-pressed="' + (plane.id === model.id) + '" aria-label="' + (has ? 'Выбрать и настроить ' : 'Посмотреть ') + plane.name + '">' + aircraft(plane.id) + '<b>' + plane.name + '</b><small>' + (has ? active ? icon('check') + ' Выбран' : 'В ангаре' : icon(plane.currency === 'gold' ? 'gold' : 'silver') + ' ' + money(plane.price)) + '</small></button>';
  }).join('');
  const specs: [IconName, string, string][] = [['armor', 'Прочность', Math.round(stats.hp) + ' HP'], ['engine', 'Скорость', Math.round(stats.speed) + ''], ['turnRight', 'Манёвр', Math.round(stats.turn * 180 / Math.PI) + '°/с'], ['target', 'Урон', stats.damage.toFixed(1).replace('.0', '')]];
  const branches: [Upgrade, IconName, string, string][] = [['hull', 'armor', 'Броня', '+3% прочности'], ['engine', 'engine', 'Двигатель', '+2% скорости'], ['gun', 'target', 'Вооружение', '+3% урона']];
  const improvements = branches.map(([branch, symbol, name, detail]) => {
    const n = upgrades[branch], cost = 100 * (n + 1) ** 2, requiredRank = [2, 3, 5, 7, 9][n] ?? 9;
    const locked = !owned || !selected || n >= 5 || rank < requiredRank || p.silver < cost;
    return '<section class="improvement"><span class="improvement-icon">' + icon(symbol) + '</span><div><h3>' + name + '</h3><small>' + detail + '</small></div><span class="upgrade-level">' + n + '/5</span><div class="upgrade-steps" aria-hidden="true">' + Array.from({ length: 5 }, (_, i) => '<i class="' + (i < n ? 'filled' : '') + '"></i>').join('') + '</div><button class="button" data-upgrade="' + branch + '" ' + (locked ? 'disabled' : '') + '>' + (n >= 5 ? 'Максимум' : rank < requiredRank ? 'Нужен ранг ' + requiredRank : icon('silver') + ' ' + money(cost) + ' · Улучшить') + '</button>' + (n < 5 ? '<span class="upgrade-price">' + (rank < requiredRank ? icon('silver') + ' ' + money(cost) : p.silver < cost ? 'Не хватает ' + money(cost - p.silver) + ' серебра' : 'Следующий уровень') + '</span>' : '') + '</section>';
  }).join('');
  const equipment = MODULES.map(module => {
    const has = p.modules.includes(module.id), active = p.module === module.id;
    return '<section class="equipment-card ' + (active ? 'equipped' : '') + '"><span class="equipment-icon">' + icon(module.id === 'carburetor' ? 'engine' : 'cooling') + '</span><div><h3>' + module.name + '</h3><p>' + module.detail + '</p></div><button class="button ' + (has ? 'subtle' : 'gold-button') + '" data-' + (has ? 'module-equip' : 'module-buy') + '="' + (active ? '' : module.id) + '" ' + (!has && p.gold < module.price ? 'disabled' : '') + '>' + (has ? active ? icon('check') + ' Снять' : 'Установить' : icon('gold') + ' ' + module.price + ' · Купить') + '</button></section>';
  }).join('');
  return '<div class="page-heading"><h1>Самолёты</h1><span class="rank-note">Ранг ' + rank + ' · ' + money(p.xp) + ' опыта</span></div><div class="aircraft-collection" aria-label="Самолёты ангара">' + collection + '</div>' +
    '<section class="aircraft-detail"><div class="detail-portrait" style="--plane-color:' + model.color + '">' + aircraft(model.id) + '</div><div class="detail-info"><div class="detail-title"><h2>' + model.name + '</h2><span class="model-badge">' + (model.currency === 'gold' ? 'За золото' : 'Ранг ' + model.rank) + '</span></div><p>' + model.role + '</p><div class="aircraft-specs">' + specs.map(([symbol, label, value]) => '<div>' + icon(symbol) + '<small>' + label + '</small><b>' + value + '</b></div>').join('') + '</div>' +
    (owned ? '<button class="button subtle detail-action" data-tab="play">К вылету ' + icon('arrow') + '</button>' : '<button class="button ' + (model.currency === 'gold' ? 'gold-button' : '') + ' detail-action" data-buy="' + model.id + '" ' + (rankLocked || !affordable ? 'disabled' : '') + '>Купить · ' + icon(priceIcon) + ' ' + money(model.price) + '</button><small class="purchase-note">' + (rankLocked ? 'Откроется на ранге ' + model.rank : !affordable ? 'Не хватает ' + money(model.price - p[model.currency]) + ' ' + (model.currency === 'gold' ? 'золота' : 'серебра') : 'Самолёт останется в вашем ангаре') + '</small>' + (model.currency === 'gold' && !affordable ? '<button class="plain" data-tab="store">Пополнить золото ' + icon('arrow') + '</button>' : '')) + '</div></section>' +
    (owned ? '<div class="subheading"><h2>Улучшения</h2></div><div class="improvement-grid">' + improvements + '</div><div class="subheading"><h2>Оснащение</h2><span>Один модуль для всех самолётов</span></div><div class="equipment-grid">' + equipment + '</div>' : '<p class="locked-improvements">Улучшения и оснащение доступны после покупки самолёта.</p>');
}

type StoreState = { available: boolean; authorized: boolean; platformAvailable: boolean; products: { id: string; price: string }[] };
export function renderStore(p: Profile, state: StoreState) {
  const goldCards = GOLD_PACKS.map(pack => {
    const product = state.products.find(x => x.id === pack.id);
    return '<section class="gold-pack"><div>' + icon('gold') + '</div><h2>' + pack.gold + '</h2><small>золота</small><button class="button gold-button" data-pack="' + pack.id + '" ' + (!state.available || !product ? 'disabled' : '') + '>' + (product ? escapeHtml(product.price) : 'Недоступно') + '</button></section>';
  }).join('');
  return '<div class="page-heading"><h1>Магазин</h1></div><h2 class="store-title">Золото</h2>' + (!state.available ? '<p class="store-notice">Покупки золота пока недоступны.</p>' : '') +
    (state.platformAvailable && !state.authorized ? '<button class="plain" data-action="authorize">Войти в Яндекс для покупок ' + icon('arrow') + '</button>' : '') +
    '<div class="store-grid">' + goldCards + '</div>' + (state.available ? '<button class="plain" data-action="recover">Восстановить покупки</button>' : '') +
    '<div class="subheading"><h2>Переплавка золота</h2></div><p class="exchange-rate">1 золото = 25 серебра или 8 опыта</p><div class="exchange-grid">' + [10, 50, 100].map(amount => '<section class="exchange-card"><b>' + icon('gold') + ' ' + amount + '</b><button class="plain" data-exchange="' + amount + '" data-currency="silver" ' + (p.gold < amount ? 'disabled' : '') + '>' + icon('arrow') + ' ' + icon('silver') + ' ' + money(amount * 25) + '</button><button class="plain" data-exchange="' + amount + '" data-currency="xp" ' + (p.gold < amount ? 'disabled' : '') + '>' + icon('arrow') + ' ' + amount * 8 + ' опыта</button></section>').join('') + '</div>';
}
