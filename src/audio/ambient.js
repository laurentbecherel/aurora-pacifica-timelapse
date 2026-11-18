// Procedural ambient audio (opt-in): swell, wind, rain, thunder.
// Everything is filtered noise — no audio assets to load.
export class AmbientAudio {
  constructor() {
    this.ctx = null; this.on = false; this.thunderAt = -1;
  }
  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < ch.length; i++) { // pinkish noise
      const w = Math.random() * 2 - 1;
      last = last * 0.94 + w * 0.06 * 6;
      ch[i] = (last + w * 0.18) * 0.6;
    }
    const make = (type, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.5;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start();
      return { f, g };
    };
    this.swell = make('lowpass', 220, 0.4, 0.16);
    this.wind = make('bandpass', 700, 0.6, 0.0);
    this.rain = make('highpass', 2600, 0.4, 0.0);
    // Slow swell LFO.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.07;
    lfo.connect(lfoG).connect(this.swell.g.gain);
    lfo.start();
    this.master = ctx.createGain(); // thunder path
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);
    this.noiseBuf = noiseBuf;
    this.on = true;
  }
  stop() { if (this.ctx) this.ctx.suspend(); this.on = false; }
  // w: {windKt, rain, sea}
  update(w) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.wind.g.gain.setTargetAtTime(Math.min(0.22, w.windKt * 0.004), t, 0.4);
    this.wind.f.frequency.setTargetAtTime(450 + w.windKt * 16, t, 0.5);
    this.rain.g.gain.setTargetAtTime(w.rain * 0.11, t, 0.3);
    this.swell.f.frequency.setTargetAtTime(170 + w.sea * 22, t, 0.6);
  }
  thunder(delaySec = 1.2, strength = 1) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t0 = ctx.currentTime + delaySec;
    if (t0 < this.thunderAt) return;
    this.thunderAt = t0 + 2;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5 * strength, t0 + 0.09);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0); src.stop(t0 + 2.8);
  }
}
