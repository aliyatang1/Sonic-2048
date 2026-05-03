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

  // optional gameHistory passed from the app to avoid circular imports
  const gameHistory = Array.isArray(opts.gameHistory) ? opts.gameHistory : null;

  // --- WaveShaper / distortion utility ---
  function makeDistortionCurve(amount = 20, n = 2048) {
    const curve = new Float32Array(n);
    const k = typeof amount === 'number' ? amount : 20;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      // smooth tanh-like saturation curve; amount controls drive
      curve[i] = Math.tanh(k * x);
    }
    return curve;
  }

  function createWaveShaper(amount = 12) {
    const ws = ctx.createWaveShaper();
    ws.curve = makeDistortionCurve(amount);
    ws.oversample = '4x';
    return ws;
  }

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
  function playFMSynth(freq, when = ctx.currentTime, duration = 0.6, opts = {}) {
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
    // route notes through waveshaper only for gritty/high-value tiles
    if (opts.distort) {
      const wsAmount = Math.min(60, Math.max(6, Math.log2((opts.value || 2)) * 8));
      const ws = createWaveShaper(wsAmount);
      outGain.connect(ws);
      ws.connect(masterGain);
    } else {
      outGain.connect(masterGain);
    }

    // start
    const env = applyADSR(outGain, when, { attack: 0.004, decay: 0.3, sustain: 0.015, release: 0.5, peak: 0.15 });

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
  function playSubtractive(freq, when = ctx.currentTime, duration = 0.7, opts = {}) {
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
    if (opts.distort) {
      const wsAmount = Math.min(60, Math.max(6, Math.log2((opts.value || 2)) * 6));
      const ws = createWaveShaper(wsAmount);
      filter.connect(ws);
      ws.connect(masterGain);
    } else {
      filter.connect(masterGain);
    }

    const env = applyADSR(mixGain, when, { attack: 0.006, decay: 0.24, sustain: 0.02, release: 0.48, peak: 0.15 });

    oscA.start(when);
    oscB.start(when);
    oscC.start(when);

    const stopTime = when + duration + env.releaseTime + 0.05;
    releaseADSR(mixGain, when + duration, env.releaseTime);
    oscA.stop(stopTime);
    oscB.stop(stopTime);
    oscC.stop(stopTime);
  }

  // --- Look-ahead scheduler ---
  const scheduler = {
    timerId: null,
    isPlaying: false,
    queue: [],
    nextIndex: 0,
    scheduleAheadTime: typeof opts.scheduleAheadTime === 'number' ? opts.scheduleAheadTime : 0.5, // seconds
    lookAhead: typeof opts.lookAhead === 'number' ? opts.lookAhead : 0.025 // interval in seconds
  };

  function scheduleNoteAt(value, time) {
    const numeric = Number(value) || 2;
    const freq = valueToFreq(numeric);
    const duration = Math.min(0.9, 0.18 + (Math.log2(numeric || 2) * 0.02));
    const distort = numeric >= (opts.distortThreshold || 32);
    if (engine === 'fm') playFMSynth(freq, time, duration, { distort, value: numeric });
    else playSubtractive(freq, time, duration, { distort, value: numeric });
  }

  function startHistoryPlayback(options = {}) {
    const spacing = typeof options.spacing === 'number' ? options.spacing : 0.16;
    const onEnd = typeof options.onEnd === 'function' ? options.onEnd : null;
    if (!gameHistory || !Array.isArray(gameHistory) || gameHistory.length === 0) return false;
    if (scheduler.isPlaying) return true;
    // copy snapshot of history to avoid mutation issues
    scheduler.queue = gameHistory.slice();
    scheduler.nextIndex = 0;
    scheduler.isPlaying = true;
    let scheduledTime = ctx.currentTime + 0.06; // small lead

    scheduler.timerId = setInterval(() => {
      const now = ctx.currentTime;
      while (scheduler.nextIndex < scheduler.queue.length && scheduledTime < now + scheduler.scheduleAheadTime) {
        const entry = scheduler.queue[scheduler.nextIndex];
        // choose representative pitch: prefer mergedValue, fallback to highest tile
        const rep = entry.mergedValue && entry.mergedValue > 0 ? entry.mergedValue : Math.max.apply(null, entry.tileValues || [2]);
        scheduleNoteAt(rep, scheduledTime);
        scheduledTime += spacing;
        scheduler.nextIndex++;
      }
      if (scheduler.nextIndex >= scheduler.queue.length) {
        // finished
        clearInterval(scheduler.timerId);
        scheduler.timerId = null;
        scheduler.isPlaying = false;
        if (onEnd) try { onEnd(); } catch (e) { console.warn('onEnd callback error', e); }
      }
    }, scheduler.lookAhead * 1000);

    return true;
  }

  function stopHistoryPlayback() {
    if (scheduler.timerId) {
      clearInterval(scheduler.timerId);
      scheduler.timerId = null;
    }
    scheduler.isPlaying = false;
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
      const distort = numeric >= (opts.distortThreshold || 32);
      if (engine === 'fm') playFMSynth(freq, now, undefined, { distort, value: numeric });
      else playSubtractive(freq, now, undefined, { distort, value: numeric });
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

    // Play back the recorded game history with sample-accurate scheduling
    startHistoryPlayback(options = {}) {
      return startHistoryPlayback(options);
    },

    stopHistoryPlayback() {
      stopHistoryPlayback();
    },

    // expose master gain for optional UI control
    _internal: { ctx, masterGain }
  };
}

export default createAudioEngine;
