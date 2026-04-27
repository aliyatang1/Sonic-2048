export function createAudioEngine({ masterGain = 0.8 } = {}) {
  const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioCtx) {
    console.warn('WebAudio not available');
    return null;
  }

  const audioCtx = new AudioCtx();
  const master = audioCtx.createGain();
  master.gain.value = masterGain;

  const compressor = audioCtx.createDynamicsCompressor();
  // default compressor settings are fine for now

  master.connect(compressor);
  compressor.connect(audioCtx.destination);
  // --- FM Synth class ---
  class FMSynth {
    constructor(ctx, output) {
      this.ctx = ctx;
      this.output = output;
    }

    // valueOrObj: number or {from, to}
    play(valueOrObj = 2, when = this.ctx.currentTime) {
      const isObj = typeof valueOrObj === 'object' && valueOrObj !== null;
      const to = isObj ? valueOrObj.to : valueOrObj;
      const from = isObj ? valueOrObj.from : null;
      const n = Math.log2(to);

      const carrier = this.ctx.createOscillator();
      const mod = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      const env = this.ctx.createGain();

      // map tile "to" value to frequency
      const base = 110; // A2 base
      const carrierFreq = base * Math.pow(2, n / 3);
      carrier.frequency.setValueAtTime(carrierFreq, when);

      // modulator frequency: influenced by "from" if present
      const fromN = from ? Math.max(0, Math.log2(from)) : 1;
      const modRatio = 1 + fromN / 4; // subtle ratio change depending on source tile
      mod.frequency.setValueAtTime(carrierFreq * modRatio, when);

      // modulation index increases with "to" and with merge size
      const mergeDepth = from ? Math.max(0, n - fromN) : 0;
      const modulationIndex = Math.max(1, n * 6 + mergeDepth * 4);
      modGain.gain.setValueAtTime(modulationIndex, when);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      carrier.type = 'sine';
      mod.type = 'sine';

      // panner: pan slightly based on mergeDepth (gives stereo movement)
      const panner = this.ctx.createStereoPanner();
      const pan = Math.max(-1, Math.min(1, (mergeDepth || 0) * 0.25));
      panner.pan.setValueAtTime(pan, when);

      // ADSR envelope (smooth pop)
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.1, when + 0.01);
      env.gain.exponentialRampToValueAtTime(0.08, when + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.25);

      carrier.connect(env);
      env.connect(panner);
      panner.connect(this.output);

      mod.start(when);
      carrier.start(when);
      carrier.stop(when + 0.25 * 5);
      mod.stop(when + 0.25 * 5);
    }
  }

  // --- Subtractive Synth class (saw + LPF) ---
  class SubtractiveSynth {
    constructor(ctx, output) {
      this.ctx = ctx;
      this.output = output;
    }

    play(value = 2, when = this.ctx.currentTime) {
      const n = Math.log2(value);
      const base = 110;
      const freq = base * Math.pow(2, n / 3);

      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, when);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      // lower cutoff for lower tiles, higher cutoff for higher tiles
      const q = Math.min(20, 1 + n * 0.5);
      filter.Q.setValueAtTime(q, when);
      const cutoff = Math.min(20000, 400 + n * 800);
      filter.frequency.setValueAtTime(cutoff, when);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.1, when + 0.01);
      env.gain.exponentialRampToValueAtTime(0.08, when + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.25);

      osc.connect(filter);
      filter.connect(env);
      env.connect(this.output);

      osc.start(when);
      osc.stop(when + 0.25 * 5);
    }
  }

  // --- SoundBoardFactory: choose engine and play ---
  class SoundBoardFactory {
    constructor(ctx, output) {
      this.ctx = ctx;
      this.output = output;
      this.engines = {
        fm: new FMSynth(ctx, output),
        subtractive: new SubtractiveSynth(ctx, output)
      };
      this.mode = 'fm';
    }

    setMode(mode) {
      if (this.engines[mode]) this.mode = mode;
    }

    toggle() {
      this.mode = this.mode === 'fm' ? 'subtractive' : 'fm';
    }

    play(value, when = this.ctx.currentTime) {
      const engine = this.engines[this.mode];
      if (engine && typeof engine.play === 'function') engine.play(value, when);
    }
  }

  const soundFactory = new SoundBoardFactory(audioCtx, master);

  // keep a simple compatibility helper
  function createOscillator(type = 'sine') {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(master);
    return { osc, gain };
  }

  return {
    audioCtx,
    master,
    compressor,
    resume: () => audioCtx.resume(),
    createOscillator,
    soundFactory,
    setEngine: (mode) => soundFactory.setMode(mode),
    toggleEngine: () => soundFactory.toggle(),
    playTileSound: (value, when) => soundFactory.play(value, when)
  };
}
