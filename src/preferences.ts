const projectileContrastKey = 'biplanes-projectile-contrast';

export function readProjectileContrast(): boolean {
  try { return localStorage.getItem(projectileContrastKey) === '1'; }
  catch { return false; }
}

export function saveProjectileContrast(enabled: boolean) {
  try { localStorage.setItem(projectileContrastKey, enabled ? '1' : '0'); }
  catch { /* The setting still works for this session without local storage. */ }
}
