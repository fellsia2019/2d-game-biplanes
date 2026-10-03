import { PLANES, planeStats, type Profile } from '../shared/data';
import type { Stats } from '../shared/simulation';

/** Pick nearby hangar models, then match the opponent's upgraded strength. */
export function duelBotStats(profile: Profile, random: () => number = Math.random): Stats {
  const player = planeStats(profile);
  const tier = PLANES.findIndex(model => model.id === player.model);
  const selected = PLANES[tier];
  const choices = PLANES.filter((model, index) => Math.abs(index - tier) <= 1
    && (model.currency !== 'gold' || selected.currency === 'gold'));
  const model = choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
  const stats = planeStats({ ...profile, selected: model.id, upgrades: {
    ...profile.upgrades, [model.id]: profile.upgrades[player.model] ?? { hull: 0, engine: 0, gun: 0 },
  } });
  for (const key of ['hp', 'speed', 'turn', 'damage'] as const) {
    stats[key] = Math.max(player[key] * .9, Math.min(player[key] * 1.1, stats[key]));
  }
  // The opponent keeps the player's equipment strength when its visual model changes.
  for (const key of ['cooling', 'boostDuration', 'boostRecharge'] as const) stats[key] = player[key];
  return stats;
}
