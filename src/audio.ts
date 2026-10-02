export class Audio {
  context?: AudioContext; muted = localStorage.getItem('biplanes-muted') === '1';
  musicMuted = localStorage.getItem('biplanes-music-muted') === '1';
  private music = new window.Audio(import.meta.env.BASE_URL + 'audio/sky-patrol.mp3');
  private unlocked = false; private suspended = false; private flight = false;
  constructor() { this.music.id = 'background-music'; this.music.hidden = true; this.music.loop = true; this.music.preload = 'none'; this.music.volume = .3; document.body.append(this.music); }
  unlock() {
    this.unlocked = true; this.context ??= new AudioContext();
    if (!this.suspended && this.context.state === 'suspended') void this.context.resume().catch(() => {});
    this.syncMusic();
  }
  private syncMusic() {
    this.music.volume = this.flight ? .23 : .3;
    if (this.unlocked && !this.musicMuted && !this.suspended) { if (this.music.paused) void this.music.play().catch(() => {}); }
    else this.music.pause();
  }
  setScene(flight: boolean) { if (flight === this.flight) return; this.flight = flight; this.syncMusic(); }
  suspend(value: boolean) {
    if (value === this.suspended) return;
    this.suspended = value;
    if (this.context) {
      if (value && this.context.state === 'running') void this.context.suspend().catch(() => {});
      else if (!value && this.unlocked && this.context.state === 'suspended') void this.context.resume().catch(() => {});
    }
    this.syncMusic();
  }
  play(kind: string) {
    if (!this.context || this.muted || this.suspended || this.context.state !== 'running') return;
    const ctx = this.context, now = ctx.currentTime, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    const explosion = kind === 'explosion', shot = kind === 'shot';
    oscillator.type = explosion ? 'sawtooth' : shot ? 'square' : 'sine';
    oscillator.frequency.setValueAtTime(explosion ? 90 : shot ? 720 : 500, now);
    oscillator.frequency.exponentialRampToValueAtTime(explosion ? 20 : shot ? 180 : 900, now + .12);
    gain.gain.setValueAtTime(explosion ? .08 : shot ? .018 : .04, now); gain.gain.exponentialRampToValueAtTime(.001, now + (explosion ? .4 : .14));
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(now); oscillator.stop(now + .4);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  toggle() { this.muted = !this.muted; localStorage.setItem('biplanes-muted', this.muted ? '1' : '0'); }
  toggleMusic() { this.musicMuted = !this.musicMuted; localStorage.setItem('biplanes-music-muted', this.musicMuted ? '1' : '0'); this.syncMusic(); }
}
