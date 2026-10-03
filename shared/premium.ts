export const PREMIUM_PRODUCT_ID = 'premium';
export const PREMIUM_EARNINGS_MULTIPLIER = 1.5;
export const PREMIUM_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// The optional expiry permits reading legacy profiles; every new grant has one.
export interface PremiumAccess { active: true; purchasedAt: number; expiresAt?: number }
export interface PremiumState { premium?: PremiumAccess }

export function premiumExpiresAt(profile: PremiumState): number | undefined {
  const access = profile.premium;
  if (access?.active !== true || !Number.isFinite(access.purchasedAt) || access.purchasedAt <= 0) return;
  const expiresAt = access.expiresAt ?? access.purchasedAt + PREMIUM_DURATION_MS;
  return Number.isFinite(expiresAt) && expiresAt > access.purchasedAt ? expiresAt : undefined;
}
export function normalizePremium(profile: PremiumState) {
  const expiresAt = premiumExpiresAt(profile);
  if (expiresAt !== undefined && profile.premium!.expiresAt === undefined) profile.premium!.expiresAt = expiresAt;
}
export function hasPremium(profile: PremiumState, now = Date.now()): boolean {
  const expiresAt = premiumExpiresAt(profile);
  return Number.isFinite(now) && expiresAt !== undefined && now < expiresAt;
}

// Use after the mode's base reward has been calculated, for combat XP/silver only.
// Half units round up, matching the existing integer campaign reward policy.
export function combatReward(amount: number, multiplier = 1): number {
  return Math.round(amount * multiplier);
}

export function premiumCombatReward(amount: number, profile: PremiumState, now = Date.now()): number {
  return combatReward(amount, hasPremium(profile, now) ? PREMIUM_EARNINGS_MULTIPLIER : 1);
}
