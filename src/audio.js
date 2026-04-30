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

  const scaleSemitones = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

  function normalizeMergePayload(valueOrObj = 2) {
    if (typeof valueOrObj === 'object' && valueOrObj !== null) {
      const to = Math.max(2, valueOrObj.to ?? 2);
      const from = valueOrObj.from ? Math.max(2, valueOrObj.from) : to / 2;
      return { from, to };
    }

    const to = Math.max(2, valueOrObj);
    return { from: to / 2, to };
  }

  function getTileStep(value) {
    return Math.max(1, Math.log2(Math.max(2, value)));
  }

  function getTileFrequency(value) {
    const tileStep = getTileStep(value);
    const scaleIndex = Math.max(0, tileStep - 1);
    const octave = Math.floor(scaleIndex / scaleSemitones.length);
    const semitone = scaleSemitones[scaleIndex % scaleSemitones.length] + octave * 12;
    return 110 * Math.pow(2, semitone / 12);
  }

  function applyPopEnvelope(gainNode, when, peak, duration) {
    const safePeak = Math.max(0.02, peak);
    const safeDuration = Math.max(0.12, duration);
    const attackEnd = when + 0.01;
    const settleEnd = when + Math.min(0.03, safeDuration * 0.25);
    const releaseEnd = when + safeDuration;

    gainNode.gain.setValueAtTime(0.0001, when);
    gainNode.gain.exponentialRampToValueAtTime(safePeak, attackEnd);
    gainNode.gain.exponentialRampToValueAtTime(safePeak * 0.72, settleEnd);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);
  }

  // --- FM Synth class ---
  class FMSynth {
    constructor(ctx, output) {
      this.ctx = ctx;
      this.output = output;
    }

    play(valueOrObj = 2, when = this.ctx.currentTime) {
      const { from, to } = normalizeMergePayload(valueOrObj);
      const toStep = getTileStep(to);
      const fromStep = getTileStep(from);
      const mergeDepth = Math.max(1, toStep - fromStep);
      const carrierFreq = getTileFrequency(to);
      const peak = Math.min(0.18, 0.07 + toStep * 0.008);
      const duration = Math.min(0.4, 0.16 + mergeDepth * 0.04);

      const carrier = this.ctx.createOscillator();
      const mod = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      const env = this.ctx.createGain();
      carrier.frequency.setValueAtTime(carrierFreq, when);

      const modRatio = 1.25 + fromStep * 0.12;
      mod.frequency.setValueAtTime(carrierFreq * modRatio, when);

      const modulationIndex = Math.min(1800, 120 + toStep * 70 + mergeDepth * 120);
      modGain.gain.setValueAtTime(modulationIndex, when);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      carrier.type = 'sine';
      mod.type = 'sine';

      const panner = this.ctx.createStereoPanner();
      const pan = Math.max(-0.75, Math.min(0.75, (mergeDepth - 1.5) * 0.22));
      panner.pan.setValueAtTime(pan, when);

      applyPopEnvelope(env, when, peak, duration);

      carrier.connect(env);
      env.connect(panner);
      panner.connect(this.output);

      mod.start(when);
      carrier.start(when);
      carrier.stop(when + duration + 0.05);
      mod.stop(when + duration + 0.05);
    }
  }

  // --- Subtractive Synth class (saw + LPF) ---
  class SubtractiveSynth {
    constructor(ctx, output) {
      this.ctx = ctx;
      this.output = output;
    }

    play(valueOrObj = 2, when = this.ctx.currentTime) {
      const { from, to } = normalizeMergePayload(valueOrObj);
      const toStep = getTileStep(to);
      const fromStep = getTileStep(from);
      const mergeDepth = Math.max(1, toStep - fromStep);
      const freq = getTileFrequency(to);
      const peak = Math.min(0.16, 0.06 + toStep * 0.007);
      const duration = Math.min(0.35, 0.14 + mergeDepth * 0.035);

      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, when);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const q = Math.min(14, 1.5 + toStep * 0.45);
      filter.Q.setValueAtTime(q, when);
      const cutoff = Math.min(12000, 700 + toStep * 550 + mergeDepth * 500);
      filter.frequency.setValueAtTime(cutoff, when);

      const env = this.ctx.createGain();
      applyPopEnvelope(env, when, peak, duration);

      osc.connect(filter);
      filter.connect(env);
      env.connect(this.output);

      osc.start(when);
      osc.stop(when + duration + 0.05);
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
      return this.mode;
    }

    getMode() {
      return this.mode;
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
    getEngine: () => soundFactory.getMode(),
    toggleEngine: () => soundFactory.toggle(),
    playTileSound: (value, when) => soundFactory.play(value, when)
  };
}
