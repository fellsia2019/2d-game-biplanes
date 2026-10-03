export const PHASE_SKILL = {id:'phase', name:'Фазовый проход', silver:1200, xp:300, unlockBoss:10, duration:2, cooldown:35} as const;
export interface PlayerSkills {phase?: boolean}
