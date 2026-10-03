export class LoadingScreen {
  private element = document.querySelector<HTMLElement>('#loading-screen');
  private progress = 0;
  private done = false;
  private timer = 0;
  stage(caption: string, progress: number) {
    if (this.done || !this.element) return;
    this.progress = Math.max(this.progress, Math.min(99, progress));
    this.element.querySelector<HTMLElement>('.loading-caption')!.textContent = caption;
    this.element.querySelector<HTMLElement>('.loading-fill')!.style.width = this.progress + '%';
    this.element.querySelector<HTMLElement>('.loading-percent')!.textContent = Math.floor(this.progress) + '%';
    this.element.querySelector<HTMLElement>('[role="progressbar"]')!.setAttribute('aria-valuenow', String(Math.floor(this.progress)));
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.fail('Загрузка занимает больше времени. Проверьте соединение и повторите.'), 25000);
  }
  fail(message: string) {
    if (this.done || !this.element) return;
    clearTimeout(this.timer);
    this.element.classList.add('loading-error');
    this.element.querySelector<HTMLElement>('.loading-caption')!.textContent = message;
    this.element.querySelector<HTMLButtonElement>('.loading-retry')!.hidden = false;
  }
  finish(onReady: () => void) {
    if (this.done) return;
    this.done = true; clearTimeout(this.timer);
    if (!this.element) { onReady(); return; }
    this.element.classList.remove('loading-error');
    this.element.querySelector<HTMLButtonElement>('.loading-retry')!.hidden = true;
    this.element.querySelector<HTMLElement>('.loading-caption')!.textContent = 'Самолёт готов к вылету';
    this.element.querySelector<HTMLElement>('.loading-fill')!.style.width = '100%';
    this.element.querySelector<HTMLElement>('.loading-percent')!.textContent = '100%';
    this.element.querySelector<HTMLElement>('[role="progressbar"]')!.setAttribute('aria-valuenow', '100');
    window.setTimeout(() => {
      this.element!.classList.add('loading-complete');
      window.setTimeout(() => { this.element!.remove(); requestAnimationFrame(onReady); }, 220);
    }, 180);
  }
}
