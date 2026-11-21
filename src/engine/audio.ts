// 音频：WebAudio 实时合成的音效与环境音乐（无外部音频文件依赖）
// 如需替换为正式录制音效，见 src/art/manifest.ts 中的 SFX_OVERRIDES。

export type Sfx =
  | 'step' | 'pickup' | 'gather' | 'craft' | 'quest' | 'click' | 'error'
  | 'open' | 'close' | 'altar' | 'potion' | 'discover' | 'rustle'
  | 'chop' | 'mine' | 'hurt' | 'swing' | 'hit' | 'eat' | 'fire' | 'build' | 'howl' | 'death' | 'whisper' | 'break';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private musicTimer: number | null = null;
  private ambience: AudioBufferSourceNode | null = null;
  private vol = { master: 0.8, music: 0.55, sfx: 0.8 };
  private overrides = new Map<string, AudioBuffer>();
  private chordIdx = 0;
  musicMood: 'menu' | 'forest' | 'ending' = 'menu';

  /** 必须在用户手势中调用 */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2);
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.sfxBus.connect(wet); wet.connect(this.reverb);
    this.reverb.connect(this.master);
    this.master.connect(ctx.destination);
    this.noiseBuf = this.makeNoise();
    this.applyVolumes();
    this.startMusic();
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  async loadOverride(name: string, url: string) {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.overrides.set(name, buf);
    } catch { /* 保持合成音效 */ }
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  private makeImpulse(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }

  private tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; attack?: number; bus?: GainNode; detune?: number; glide?: number } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, start);
    if (opts.glide) o.frequency.exponentialRampToValueAtTime(freq * opts.glide, start + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const peak = opts.gain ?? 0.2;
    const a = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + a);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(opts.bus ?? this.sfxBus);
    o.start(start); o.stop(start + dur + 0.05);
  }
  private noise(start: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(start, Math.random() * 1.5); s.stop(start + dur + 0.05);
  }

  play(name: Sfx) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ov = this.overrides.get(name);
    const t = ctx.currentTime;
    if (ov) {
      const s = ctx.createBufferSource(); s.buffer = ov; s.connect(this.sfxBus); s.start(t); return;
    }
    switch (name) {
      case 'step': this.noise(t, 0.09, 380 + Math.random() * 200, 1.2, 0.08, 'lowpass'); break;
      case 'rustle': this.noise(t, 0.35, 2400, 0.8, 0.07); break;
      case 'gather': this.noise(t, 0.12, 1800 + Math.random() * 600, 2, 0.18); this.tone(220 + Math.random() * 40, t, 0.12, { type: 'triangle', gain: 0.08 }); break;
      case 'pickup': [784, 1175, 1568].forEach((f, i) => this.tone(f, t + i * 0.06, 0.35, { type: 'sine', gain: 0.12 })); break;
      case 'craft': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, t + i * 0.07, 0.6, { type: 'triangle', gain: 0.09 })); this.noise(t, 0.6, 6000, 1, 0.04, 'highpass'); break;
      case 'quest': [392, 494, 587, 784].forEach((f, i) => { this.tone(f, t + i * 0.12, 1.4, { type: 'sine', gain: 0.12, attack: 0.02 }); this.tone(f * 2, t + i * 0.12, 0.8, { type: 'sine', gain: 0.03 }); }); break;
      case 'click': this.tone(1200, t, 0.06, { type: 'triangle', gain: 0.06 }); break;
      case 'open': this.tone(520, t, 0.18, { type: 'sine', gain: 0.08, glide: 1.5 }); this.noise(t, 0.15, 3000, 1, 0.03); break;
      case 'close': this.tone(700, t, 0.16, { type: 'sine', gain: 0.07, glide: 0.6 }); break;
      case 'error': this.tone(196, t, 0.2, { type: 'square', gain: 0.04 }); this.tone(185, t + 0.1, 0.22, { type: 'square', gain: 0.04 }); break;
      case 'potion': [660, 880, 990, 1320].forEach((f, i) => this.tone(f, t + i * 0.04, 0.5, { type: 'sine', gain: 0.07, glide: 1.06 })); this.noise(t, 0.4, 900, 3, 0.05); break;
      case 'discover': [440, 554, 659, 880].forEach((f, i) => this.tone(f, t + i * 0.15, 2, { type: 'sine', gain: 0.08, attack: 0.08 })); break;
      case 'chop': this.noise(t, 0.08, 900, 3, 0.22); this.tone(140, t, 0.12, { type: 'triangle', gain: 0.14, glide: 0.7 }); break;
      case 'mine': this.tone(1800 + Math.random() * 300, t, 0.18, { type: 'triangle', gain: 0.08 }); this.noise(t, 0.06, 3500, 2, 0.16); break;
      case 'hurt': this.tone(260, t, 0.25, { type: 'sawtooth', gain: 0.07, glide: 0.5 }); this.noise(t, 0.15, 700, 1, 0.12); break;
      case 'swing': this.noise(t, 0.14, 2200, 0.7, 0.08); break;
      case 'hit': this.noise(t, 0.08, 500, 1.5, 0.25); this.tone(110, t, 0.1, { type: 'square', gain: 0.06, glide: 0.6 }); break;
      case 'eat': [0, 0.1, 0.2].forEach((d) => this.noise(t + d, 0.06, 1200, 2, 0.12)); break;
      case 'fire': this.noise(t, 0.6, 1500, 0.5, 0.06); this.tone(180, t, 0.4, { type: 'sine', gain: 0.05, glide: 1.8 }); break;
      case 'build': [0, 0.12, 0.24].forEach((d) => { this.noise(t + d, 0.07, 700, 2, 0.2); }); this.tone(392, t + 0.3, 0.4, { type: 'triangle', gain: 0.06 }); break;
      case 'howl': this.tone(330, t, 2.2, { type: 'sine', gain: 0.07, attack: 0.4, glide: 1.45 }); this.tone(332, t + 0.05, 2.2, { type: 'triangle', gain: 0.025, attack: 0.5, glide: 1.4 }); break;
      case 'death': [392, 330, 262, 196].forEach((f, i) => this.tone(f, t + i * 0.35, 1.6, { type: 'sine', gain: 0.1, attack: 0.05 })); break;
      case 'whisper': this.noise(t, 1.2, 3200, 4, 0.05); this.noise(t + 0.3, 1, 1800, 6, 0.04); break;
      case 'break': this.noise(t, 0.2, 1200, 1, 0.18); this.tone(300, t, 0.2, { type: 'square', gain: 0.04, glide: 0.5 }); break;
      case 'altar': {
        [196, 247, 294, 392, 494, 587].forEach((f, i) => this.tone(f, t + i * 0.25, 4.5, { type: 'sine', gain: 0.1, attack: 0.6 }));
        this.noise(t, 3, 500, 0.5, 0.05, 'lowpass');
        break;
      }
    }
  }

  // ---------- 生成式环境音乐 ----------
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    // 林间风声底噪
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 180;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    s.connect(f); f.connect(g); g.connect(this.musicBus); s.start();
    this.ambience = s;
    const tick = () => { this.musicStep(); };
    tick();
    this.musicTimer = window.setInterval(tick, 4000);
  }

  private musicStep() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.05;
    // D 多利亚 / 五声调式 和弦循环，营造神秘但温暖的林间气氛
    const chordsForest = [[146.8, 220, 261.6, 329.6], [130.8, 196, 246.9, 329.6], [116.5, 174.6, 233.1, 293.7], [130.8, 196, 261.6, 311.1]];
    const chordsMenu = [[146.8, 220, 293.7, 349.2], [116.5, 174.6, 233.1, 293.7], [130.8, 196, 261.6, 329.6], [110, 164.8, 220, 277.2]];
    const chordsEnd = [[196, 246.9, 293.7, 392], [174.6, 220, 261.6, 349.2], [164.8, 196, 246.9, 329.6], [196, 246.9, 293.7, 370]];
    const set = this.musicMood === 'menu' ? chordsMenu : this.musicMood === 'ending' ? chordsEnd : chordsForest;
    const chord = set[this.chordIdx % set.length];
    this.chordIdx++;
    chord.forEach((fq, i) => {
      this.tone(fq, t + i * 0.05, 5.2, { type: 'sine', gain: 0.05, attack: 1.6, bus: this.musicBus, detune: (i % 2 ? 6 : -6) });
      this.tone(fq * 2, t + i * 0.05, 4.5, { type: 'triangle', gain: 0.012, attack: 2, bus: this.musicBus });
    });
    // 零星的铃音旋律
    const pent = [587.3, 659.3, 784, 880, 987.8, 1174.7];
    const n = this.musicMood === 'ending' ? 4 : 2;
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.65) {
        const fq = pent[Math.floor(Math.random() * pent.length)];
        this.tone(fq, t + 0.6 + Math.random() * 3, 2.4, { type: 'sine', gain: 0.035, attack: 0.01, bus: this.musicBus });
      }
    }
  }

  private rainGain: GainNode | null = null;
  setRain(level: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.rainGain) {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
      s.connect(f); f.connect(this.rainGain); this.rainGain.connect(this.sfxBus); s.start();
    }
    this.rainGain.gain.setTargetAtTime(level * 0.09, ctx.currentTime, 0.5);
  }

  stopAll() {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.ambience?.stop();
  }
}
