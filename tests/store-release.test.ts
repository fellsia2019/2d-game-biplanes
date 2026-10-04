import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStore } from '../src/menu';
import { freshProfile } from '../shared/data';
test('Релиз скрывает товары, которых нет в действующем каталоге SDK', () => {
  const html = renderStore(freshProfile('pilot'), {release: true, available: false, authorized: false, platformAvailable: true, products: []});
  assert.doesNotMatch(html, /data-pack=|Пока недоступно|Покупки пока недоступны/);
  assert.match(html, /Переплавка золота/);
});
test('Цена и иконка портальной валюты поступают из SDK, отсутствующие пакеты скрыты', () => {
  const html = renderStore(freshProfile('pilot'), {release: true, available: true, authorized: true, platformAvailable: true, products: [{id: 'gold300', price: '99 TST', getPriceCurrencyImage: () => 'https://example.org/yen.svg'}]});
  assert.match(html, /99 TST/); assert.match(html, /yen.svg/);
  assert.match(html, /data-pack="gold300"/); assert.doesNotMatch(html, /data-pack="gold100"|data-pack="gold800"|data-pack="premium"/);
});
