// Lightweight audio engine providing FM and subtractive synthesis
// Exposes: createAudioEngine() -> { playTileSound, toggleEngine, getEngine, resume }

const DEFAULT_ENGINE = 'fm';

export function createAudioEngine(opts = {}) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  const masterGain = ctx.createGain();
  masterGain.gain.value = typeof opts.masterGain === 'number' ? opts.masterGain : 0.065; // softer default
  masterGain.connect(ctx.destination);

  let engine = opts.engine || DEFAULT_ENGINE; // 'fm' or 'subtractive'

  // ADSR envelope with exponential ramps for a smooth, click-free contour.
  // The defaults are gentle and melodic, and callers can override them per note.
  function applyADSR(
    gainNode,
    currentTime,
    { attack = 0.008, decay = 0.18, sustain = 0.02, release = 0.38, peak = 0.12 } = {}
  ) {
    const peakLevel = Math.max(0.0001, peak);
    const sustainLevel = Math.max(0.0001, sustain <= 1 ? peakLevel * sustain : sustain);
    const attackEnd = currentTime + Math.max(0.001, attack);
    const decayEnd = attackEnd + Math.max(0, decay);

    gainNode.gain.cancelScheduledValues(currentTime);
    gainNode.gain.setValueAtTime(0.0001, currentTime);
    gainNode.gain.exponentialRampToValueAtTime(peakLevel, attackEnd);
    gainNode.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);

    return {
      attackEnd,
      decayEnd,
      sustainLevel,
      releaseTime: Math.max(0.0001, release)
    };
  }

  // Release phase that fades back to near silence without clicks.
  function releaseADSR(gainNode, currentTime, releaseTime = 0.1) {
    const endTime = currentTime + Math.max(0.001, releaseTime);
    gainNode.gain.cancelScheduledValues(currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);
    return endTime;
  }

  // map tile value to a pleasing frequency
  function valueToFreq(value) {
    // base frequency around A3 (220Hz) for a tile value of 2
    const base = 220;
    const steps = Math.log2(value / 2 || 1); // 2 -> 0, 4 -> 1, 8 -> 2, ...
    // map to musically pleasant scale (tempered semitones)
    const freq = base * Math.pow(2, steps);
    return freq;
  }

  // FM synth: deliberately inharmonic, bell/chime-like tones so it contrasts with subtractive synthesis
  function playFMSynth(freq, when = ctx.currentTime, duration = 0.6) {
    const modOsc = ctx.createOscillator();
    const modGain = ctx.createGain();
    const modOsc2 = ctx.createOscillator();
    const modGain2 = ctx.createGain();
    const carrier = ctx.createOscillator();
    const outGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // choose smooth waveforms, but use inharmonic ratios for a bell/chime character
    modOsc.type = 'sine';
    carrier.type = 'sine';
    modOsc2.type = 'sine';

    // FM ratios chosen to sound distinctly metallic rather than piano-like
    modOsc.frequency.value = Math.max(1, freq * 2.7);
    modGain.gain.value = Math.max(0.5, freq * 0.02);
    modOsc2.frequency.value = Math.max(1, freq * 4.1);
    modGain2.gain.value = Math.max(0.25, freq * 0.009);

    // lowpass keeps it soft while still letting the chimey transient through
    filter.type = 'lowpass';
    filter.frequency.value = Math.max(1200, freq * 3.2);
    filter.Q.value = 0.55;

    outGain.gain.value = 0.0001;

    // routing: two modulators drive the carrier for an inharmonic FM spectrum
    modOsc.connect(modGain);
    modGain.connect(carrier.frequency);
    modOsc2.connect(modGain2);
    modGain2.connect(carrier.frequency);
    carrier.connect(filter);
    filter.connect(outGain);
    outGain.connect(masterGain);

    // start
    const env = applyADSR(outGain, when, { attack: 0.004, decay: 0.3, sustain: 0.015, release: 0.5, peak: 0.08 });

    carrier.frequency.setValueAtTime(freq, when);
    modOsc.start(when);
    modOsc2.start(when);
    carrier.start(when);

    // schedule stop
    const stopTime = when + duration + env.releaseTime + 0.05;
    releaseADSR(outGain, when + duration, env.releaseTime);
    carrier.stop(stopTime);
    modOsc.stop(stopTime);
    modOsc2.stop(stopTime);
  }

  // Subtractive synth: warmer, piano-like tone shaped by filtering and detuned partials
  function playSubtractive(freq, when = ctx.currentTime, duration = 0.7) {
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const oscC = ctx.createOscillator();
    const mixGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    oscA.type = 'triangle';
    oscB.type = 'sine';
    oscC.type = 'triangle';
    oscA.frequency.value = freq;
    oscB.frequency.value = freq * 2;
    oscB.detune.value = -6;
    oscC.frequency.value = freq * 0.997;
    oscC.detune.value = 4;

    // mix and gentle volume
    mixGain.gain.value = 0.0001;

    filter.type = 'lowpass';
    filter.frequency.value = Math.max(900, freq * 2.4);
    filter.Q.value = 0.45;

    oscA.connect(mixGain);
    oscB.connect(mixGain);
    oscC.connect(mixGain);
    mixGain.connect(filter);
    filter.connect(masterGain);

    const env = applyADSR(mixGain, when, { attack: 0.006, decay: 0.24, sustain: 0.02, release: 0.48, peak: 0.08 });

    oscA.start(when);
    oscB.start(when);
    oscC.start(when);

    const stopTime = when + duration + env.releaseTime + 0.05;
    releaseADSR(mixGain, when + duration, env.releaseTime);
    oscA.stop(stopTime);
    oscB.stop(stopTime);
    oscC.stop(stopTime);
  }

  // public API
  return {
    // trigger a pleasant note derived from tile value or arbitrary numeric input
    playTileSound(valueOrPayload) {
      // unify whether caller passed full event payload or raw value
      const value = typeof valueOrPayload === 'object' && valueOrPayload !== null ? (valueOrPayload.value || valueOrPayload.to || valueOrPayload.from || 2) : valueOrPayload;
      const numeric = Number(value) || 2;
      const freq = valueToFreq(numeric);
      const now = ctx.currentTime + 0.005;
      if (engine === 'fm') playFMSynth(freq, now);
      else playSubtractive(freq, now);
    },

    // toggle between 'fm' and 'subtractive'
    toggleEngine() {
      engine = engine === 'fm' ? 'subtractive' : 'fm';
      return engine;
    },

    getEngine() {
      return engine;
    },

    // resume audio context (useful for user gesture restrictions)
    async resume() {
      if (ctx.state === 'suspended') await ctx.resume();
    },

    // expose master gain for optional UI control
    _internal: { ctx, masterGain }
  };
}

export default createAudioEngine;
