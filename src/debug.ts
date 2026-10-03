import { ZONE, type Profile } from '../shared/data';
import type { Battle } from '../shared/simulation';
import { icon } from './icons';

export class DebugPanel {
  private root = document.createElement('aside');
  private enabled = false;
  private busy = false;
  private battle?: Battle;
  private training = false;
  isOpen = false;
  constructor(private action: (action: string, amount: number) => Promise<unknown>, private pause: (open: boolean) => void, private fail: (message: string) => void) {
    this.root.id = 'debug-panel'; this.root.hidden = true;
    this.root.innerHTML = '<button class="debug-toggle" type="button" aria-expanded="false" aria-controls="debug-controls">' + icon('repair') + ' Debug <kbd>F2</kbd></button><section id="debug-controls" hidden><header><b>Пульт тестирования</b><span>ЛОКАЛЬНЫЙ РЕЖИМ</span></header><p class="debug-wallet"></p><label>Количество <input type="number" min="1" max="1000000" step="1" value="1000" aria-label="Количество debug-ресурсов"></label><div class="debug-money"><button type="button" data-debug="xp">+ Опыт</button><button type="button" data-debug="gold">+ Золото</button><button type="button" data-debug="silver">+ Серебро</button></div><p class="debug-level"></p><div class="debug-battle"><button type="button" data-debug="next-level">Следующий уровень +1</button><button type="button" data-debug="win-boss">' + icon('trophy') + ' Победить босса</button></div><small>Панель ставит полёт на паузу. Ресурсы и прогресс сохраняются.</small></section>';
    document.body.append(this.root);
    this.root.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
      if (button.classList.contains('debug-toggle')) { this.toggle(); return; }
      if (!button.dataset.debug || this.busy) return;
      const amount = Number(this.root.querySelector<HTMLInputElement>('input')!.value);
      this.busy = true; this.updateButtons();
      void this.action(button.dataset.debug, amount).catch(error => this.fail(error.message || 'Debug-действие не выполнено')).finally(() => { this.busy = false; this.updateButtons(); });
    });
    window.addEventListener('keydown', e => { if (this.enabled && e.code === 'F2' && !e.repeat) { e.preventDefault(); this.toggle(); } });
  }
  private toggle() {
    this.isOpen = !this.isOpen;
    this.root.querySelector<HTMLElement>('#debug-controls')!.hidden = !this.isOpen;
    this.root.querySelector('button')!.setAttribute('aria-expanded', String(this.isOpen));
    this.pause(this.isOpen);
  }
  setEnabled(enabled: boolean) { this.enabled = enabled; this.root.hidden = !enabled; }
  update(p: Profile | undefined, battle: Battle | undefined, training: boolean) {
    this.battle = battle; this.training = training;
    this.root.querySelector<HTMLElement>('.debug-wallet')!.textContent = p ? 'XP ' + p.xp + ' · золото ' + p.gold + ' · серебро ' + p.silver : 'Загрузка профиля…';
    this.root.querySelector<HTMLElement>('.debug-level')!.textContent = training ? 'Обучение: переходы отключены' : battle?.mode === 'pve' ? 'Кампания · уровень ' + battle.level + ' / ' + ZONE.length : 'Для переходов запустите кампанию';
    this.updateButtons();
  }
  private updateButtons() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-debug]').forEach(button => {
      const battleAction = ['next-level', 'win-boss'].includes(button.dataset.debug!);
      button.disabled = this.busy || battleAction && (this.training || this.battle?.mode !== 'pve' || this.battle.phase === 'reward') || button.dataset.debug === 'win-boss' && (!ZONE[(this.battle?.level ?? 1) - 1]?.boss || this.battle?.phase === 'ended') || button.dataset.debug === 'next-level' && (this.battle?.level ?? 1) >= ZONE.length;
    });
  }
}
