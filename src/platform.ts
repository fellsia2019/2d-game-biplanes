export interface Product { id: string; price: string; priceValue: string; priceCurrencyCode: string }
interface Player { isAuthorized(): boolean; getData(keys: string[]): Promise<{ biplanesToken?: string }>; setData(data: object, flush: boolean): Promise<void> }
interface Payments { getCatalog(): Promise<Product[]>; purchase(options: { id: string; developerPayload: string }): Promise<{ signature: string }>; getPurchases(): Promise<{ signature: string }>; consumePurchase(token: string): Promise<void> }
interface Sdk {
  features: { LoadingAPI?: { ready(): void }; GameplayAPI?: { start(): void; stop(): void } };
  on(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
  getPlayer(): Promise<Player>; getPayments(options: { signed: true }): Promise<Payments>;
  auth: { openAuthDialog(): Promise<void> };
}
declare global { interface Window { YaGames?: { init(): Promise<Sdk> } } }
type Rpc = (type: string, data?: object) => Promise<any>;
async function deadline<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Platform timeout')), ms); })]); }
  finally { clearTimeout(timer!); }
}
export class Platform {
  private sdk?: Sdk; private player?: Player; private payments?: Payments;
  private playing = false; private ready = false; private readySent = false; private busy = false;
  private token?: string; private cloudSaved = false; private cloudRead = false; private recovery?: Promise<void>;
  products: Product[] = []; onChange?: () => void;
  get available() { return !!this.sdk; }
  get authorized() { return this.player?.isAuthorized() ?? false; }
  get canPay() { return !!this.payments && this.authorized && this.cloudSaved; }
  async init(pause: (value: boolean) => void) {
    try {
      if (!window.YaGames && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script'); s.src = '/sdk.js'; s.async = true;
          const timeout = setTimeout(() => reject(new Error('SDK timeout')), 8000);
          s.onload = () => { clearTimeout(timeout); resolve(); }; s.onerror = () => { clearTimeout(timeout); reject(new Error('SDK unavailable')); }; document.head.append(s);
        });
      }
      if (!window.YaGames) return;
      this.sdk = await deadline(window.YaGames.init());
      this.sdk.on('game_api_pause', () => pause(true)); this.sdk.on('game_api_resume', () => pause(false));
      this.notifyReady();
      if (this.playing) this.sdk.features.GameplayAPI?.start();
      await Promise.all([
        (async () => { try { this.player = await deadline(this.sdk!.getPlayer(), 4000); await this.readCloudToken(); } catch { /* Remain a guest. */ } })(),
        (async () => { try { this.payments = await deadline(this.sdk!.getPayments({ signed: true }), 4000); this.products = await deadline(this.payments.getCatalog(), 4000); } catch { this.payments = undefined; } })(),
      ]);
    } catch { /* Local mode remains playable. */ }
  }
  private async readCloudToken() {
    if (!this.authorized) return;
    const data = await deadline(this.player!.getData(['biplanesToken']), 4000);
    this.cloudRead = true;
    if (typeof data.biplanesToken === 'string' && /^[a-f0-9]{64}$/.test(data.biplanesToken)) { this.token = data.biplanesToken; this.cloudSaved = true; }
  }
  getToken() { return this.token ?? localStorage.getItem('biplanes-token'); }
  async rememberToken(token: string) {
    if (this.authorized) {
      if (!this.cloudRead) await this.readCloudToken();
      if (this.cloudSaved && this.token && this.token !== token) throw new Error('Облачный ангар ещё не загружен. Повторите вход.');
      if (this.cloudSaved && this.token === token) return;
      await this.player!.setData({ biplanesToken: token }, true);
      this.cloudSaved = true; this.onChange?.();
    }
    this.token = token;
  }
  async authorize() {
    if (!this.sdk) throw new Error('Вход в Яндекс доступен на странице игры');
    await this.sdk.auth.openAuthDialog(); this.player = await this.sdk.getPlayer(); this.cloudSaved = false; this.cloudRead = false;
    if (!this.authorized) throw new Error('Вход не завершён');
    await this.readCloudToken(); this.onChange?.();
    return this.token;
  }
  recover(rpc: Rpc): Promise<void> {
    if (this.recovery) return this.recovery;
    this.recovery = this.recoverOnce(rpc).finally(() => this.recovery = undefined);
    return this.recovery;
  }
  private async recoverOnce(rpc: Rpc) {
    if (!this.canPay || !this.payments) return;
    const pending = await this.payments.getPurchases();
    const result = await rpc('payment-redeem', { signature: pending.signature });
    for (const token of result.consume) await this.payments.consumePurchase(token);
    if (result.pending.length) throw new Error('Некоторые покупки ожидают проверки ангара');
  }
  async purchase(id: string, rpc: Rpc) {
    if (this.busy || !this.canPay || !this.payments) throw new Error('Войдите в Яндекс и дождитесь сохранения ангара');
    this.busy = true;
    let paid = false;
    try {
      if (this.recovery) await this.recovery;
      const order = await rpc('payment-order', { sku: id });
      await this.payments.purchase({ id, developerPayload: order.id });
      paid = true;
      await this.recover(rpc);
    } catch (error) {
      if (paid) throw new Error('Оплата завершена. Начисление ожидает восстановления — проверьте покупки после восстановления связи.');
      throw error;
    } finally { this.busy = false; }
  }
  private notifyReady() { if (!this.sdk || !this.ready || this.readySent) return; this.sdk.features.LoadingAPI?.ready(); this.readySent = true; }
  markReady() { this.ready = true; this.notifyReady(); }
  gameplay(active: boolean) {
    if (active === this.playing) return; this.playing = active;
    if (active) this.sdk?.features.GameplayAPI?.start(); else this.sdk?.features.GameplayAPI?.stop();
  }
}
