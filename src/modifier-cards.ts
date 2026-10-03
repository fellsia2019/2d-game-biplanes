import { MODIFIERS, MODIFIER_TIERS, modifierCopy, modifierLevel, type ModifierId, type ModifierOffer } from '../shared/modifiers';
import { bossBalance, type Profile } from '../shared/data';
import { icon } from './icons';

function card(id: ModifierId, level: number, state: 'owned' | 'available' | 'choice', upgrade = false) {
  const mod = MODIFIERS.find(m => m.id === id)!, tier = MODIFIER_TIERS[mod.tier], copy = modifierCopy(id, level);
  const tag = state === 'choice' ? 'button' : 'article';
  return '<' + tag + ' class="modifier-card tier-' + mod.tier + ' modifier-' + state + '" ' + (state === 'choice' ? 'type="button" data-modifier="' + id + '" aria-label="Выбрать ' + mod.name + (upgrade ? ', улучшение до уровня ' + level : '') + '"' : '') + '>' +
    '<span class="modifier-card-top"><span class="modifier-rarity"><i></i>' + tier.name + '</span><span class="modifier-number">' + tier.mark + '</span></span>' +
    '<span class="modifier-art" aria-hidden="true"><i></i>' + icon(mod.symbol) + '<span class="modifier-stars">' + '◆'.repeat(Object.keys(MODIFIER_TIERS).indexOf(mod.tier) + 1) + '</span></span>' +
    '<span class="modifier-category">' + mod.category + '</span><span class="modifier-name">' + mod.name + '</span><span class="modifier-metric">' + copy.metric + '</span><span class="modifier-description">' + copy.detail + '</span>' +
    '<span class="modifier-card-foot">' + (state === 'owned' ? icon('check') + ' Получен · ур. ' + level : state === 'choice' ? (upgrade ? 'Улучшить до ур. ' + level : 'Выбрать навсегда') + icon('arrow') : 'Не получен · награда за босса') + '</span></' + tag + '>';
}
export function renderModifiers(p: Profile, filter: 'all' | 'owned') {
  const owned = p.modifiers ?? [], visible = MODIFIERS.filter(m => filter === 'all' || owned.some(o => o.id === m.id));
  return '<div class="page-heading"><div><span class="collection-kicker">НАСЛЕДИЕ ПИЛОТА</span><h1>Модификаторы</h1></div><span class="collection-count">' + owned.length + '<small>/ ' + MODIFIERS.length + '</small></span></div>' +
    '<p class="collection-intro">Ваш постоянный набор для всей карьеры. Действует на любом самолёте и сохраняется при откате этапа. Каждый выбор остаётся навсегда.</p>' +
    '<div class="collection-toolbar" role="tablist" aria-label="Модификаторы"><button role="tab" class="collection-filter ' + (filter === 'owned' ? 'selected' : '') + '" data-modifier-filter="owned" aria-selected="' + (filter === 'owned') + '">Мои модификаторы <b>' + owned.length + '</b></button><button role="tab" class="collection-filter ' + (filter === 'all' ? 'selected' : '') + '" data-modifier-filter="all" aria-selected="' + (filter === 'all') + '">Каталог <b>' + MODIFIERS.length + '</b></button></div>' +
    (visible.length ? '<div class="modifier-grid">' + visible.map(m => { const level = modifierLevel(owned, m.id); return card(m.id, level || 1, level ? 'owned' : 'available'); }).join('') + '</div>' : '<div class="collection-empty">' + icon('cards') + '<h2>Первая карточка ждёт у босса</h2><p>Победите Капитана Бурю на уровне 10 и выберите один из трёх модификаторов.</p><button class="button" data-tab="play">К вылету ' + icon('arrow') + '</button></div>') +
    '<p class="collection-note">Четыре редкости · новые карточки без повторов. Когда коллекция собрана, боссы предлагают улучшить полученные модификаторы. В дуэлях эти бонусы не действуют.</p>';
}
export function renderModifierReward(p: Profile, offer: ModifierOffer) {
  const boss = bossBalance(offer.bossLevel);
  return '<div class="shade career-shade"><section class="modifier-reward" role="dialog" aria-modal="true" aria-labelledby="reward-title"><div class="reward-heading"><span class="reward-emblem">' + icon('trophy') + '</span><div><span class="collection-kicker">БОСС ' + offer.bossLevel + ' ПОБЕЖДЁН · ' + boss.name + '</span><h1 id="reward-title">' + (offer.upgrade ? 'Усиление наследия' : 'Выберите свой модификатор') + '</h1></div></div><p class="reward-intro">' + (offer.upgrade ? 'Все карточки собраны. Улучшите одну из трёх способностей.' : 'Одна карточка останется с вами на всю карьеру, на любом самолёте.') + ' Перевыбрать её нельзя.</p><div class="modifier-grid reward-cards">' + offer.options.map(id => card(id, offer.upgrade ? modifierLevel(p.modifiers, id) + 1 : 1, 'choice', offer.upgrade)).join('') + '</div><div class="reward-footer"><span>' + icon('armor') + ' Сохраняется при откате этапа</span><span>' + (offer.upgrade ? 'УЛУЧШЕНИЕ' : 'ВЫБОР 1 ИЗ ' + offer.options.length) + '</span></div></section></div>';
}
