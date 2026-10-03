export const PREMIUM_PRODUCT_ID = 'premium';
export const PREMIUM_EARNINGS_MULTIPLIER = 1.5;

// Lifetime entitlement. Only a verified, persisted payment can create this state.
export interface PremiumAccess { active: true; purchasedAt: number }
export interface PremiumState { premium?: PremiumAccess }

export function hasPremium(profile: PremiumState): boolean {
  return profile.premium?.active === true && Number.isFinite(profile.premium.purchasedAt) && profile.premium.purchasedAt > 0;
}

// Use after the mode's base reward has been calculated, for combat XP/silver only.
// Half units round up, matching the existing integer campaign reward policy.
export function combatReward(amount: number, multiplier = 1): number {
  return Math.round(amount * multiplier);
}

export function premiumCombatReward(amount: number, profile: PremiumState): number {
  return combatReward(amount, hasPremium(profile) ? PREMIUM_EARNINGS_MULTIPLIER : 1);
}
