// Lightweight audio engine providing FM and subtractive synthesis
// Exposes: createAudioEngine() -> { playTileSound, toggleEngine, getEngine, resume }

const DEFAULT_ENGINE = 'fm';
const BASE_FREQUENCY = 220;
const SCALE_SEMITONES = [0, 2, 3, 5, 7, 9, 10, 12];
const DIRECTION_INTERVALS = {
  up: 7,
  down: -5,
  left: 0,
  right: 2
};
const DIRECTION_RHYTHMS = {
  up: 0.16,
  down: 0.2,
  left: 0.12,
  right: 0.24
};

export function createAudioEngine(opts = {}) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  const masterGain = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  masterGain.gain.value = typeof opts.masterGain === 'number' ? opts.masterGain : 0.07;
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);

  let engine = opts.engine || DEFAULT_ENGINE;
  let muted = !!opts.muted;
  const gameHistory = Array.isArray(opts.gameHistory) ? opts.gameHistory : null;

  function makeDistortionCurve(amount = 20, samples = 2048) {
    const curve = new Float32Array(samples);
    const drive = typeof amount === 'number' ? amount : 20;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(drive * x);
    }
    return curve;
  }

  function createWaveShaper(amount = 12) {
    const waveShaper = ctx.createWaveShaper();
    waveShaper.curve = makeDistortionCurve(amount);
    waveShaper.oversample = '4x';
    return waveShaper;
  }

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
      releaseTime: Math.max(0.0001, release)
    };
  }

  function releaseADSR(gainNode, currentTime, releaseTime = 0.1) {
    const endTime = currentTime + Math.max(0.001, releaseTime);
    gainNode.gain.cancelScheduledValues(currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);
    return endTime;
  }

  function valueToFreq(value, semitoneOffset = 0) {
    const numeric = Math.max(2, Number(value) || 2);
    const tileStep = Math.max(0, Math.log2(numeric / 2));
    const octave = Math.floor(tileStep / SCALE_SEMITONES.length);
    const semitone = SCALE_SEMITONES[tileStep % SCALE_SEMITONES.length] + octave * 12 + semitoneOffset;
    return BASE_FREQUENCY * Math.pow(2, semitone / 12);
  }

  function playFMSynth(freq, when = ctx.currentTime, duration = 0.6, note = {}) {
    const modOsc = ctx.createOscillator();
    const modGain = ctx.createGain();
    const modOsc2 = ctx.createOscillator();
    const modGain2 = ctx.createGain();
    const carrier = ctx.createOscillator();
    const outGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    modOsc.type = 'sine';
    carrier.type = 'sine';
    modOsc2.type = 'sine';

    modOsc.frequency.value = Math.max(1, freq * (2.2 + note.harmonicLift * 0.2));
    modGain.gain.value = Math.max(0.5, freq * (0.012 + note.brightness * 0.01));
    modOsc2.frequency.value = Math.max(1, freq * (3.6 + note.harmonicLift * 0.28));
    modGain2.gain.value = Math.max(0.25, freq * (0.005 + note.brightness * 0.004));

    filter.type = 'lowpass';
    filter.frequency.value = Math.max(1200, freq * (2.4 + note.brightness * 1.2));
    filter.Q.value = 0.55 + note.brightness * 0.2;
    outGain.gain.value = 0.0001;

    modOsc.connect(modGain);
    modGain.connect(carrier.frequency);
    modOsc2.connect(modGain2);
    modGain2.connect(carrier.frequency);
    carrier.connect(filter);
    filter.connect(outGain);

    if (note.distort) {
      const wsAmount = Math.min(60, Math.max(8, note.distortionAmount));
      const ws = createWaveShaper(wsAmount);
      outGain.connect(ws);
      ws.connect(masterGain);
    } else {
      outGain.connect(masterGain);
    }

    const env = applyADSR(outGain, when, {
      attack: 0.004,
      decay: 0.26 + note.duration * 0.18,
      sustain: 0.02,
      release: 0.4 + note.brightness * 0.16,
      peak: note.amplitude
    });

    carrier.frequency.setValueAtTime(freq, when);
    modOsc.start(when);
    modOsc2.start(when);
    carrier.start(when);

    const stopTime = when + duration + env.releaseTime + 0.05;
    releaseADSR(outGain, when + duration, env.releaseTime);
    carrier.stop(stopTime);
    modOsc.stop(stopTime);
    modOsc2.stop(stopTime);
  }

  function playSubtractive(freq, when = ctx.currentTime, duration = 0.7, note = {}) {
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const oscC = ctx.createOscillator();
    const mixGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    oscA.type = 'triangle';
    oscB.type = 'sine';
    oscC.type = 'triangle';
    oscA.frequency.value = freq;
    oscB.frequency.value = freq * (1.98 + note.harmonicLift * 0.08);
    oscB.detune.value = -6;
    oscC.frequency.value = freq * 0.997;
    oscC.detune.value = 4;

    mixGain.gain.value = 0.0001;
    filter.type = 'lowpass';
    filter.frequency.value = Math.max(900, freq * (1.9 + note.brightness * 0.9));
    filter.Q.value = 0.42 + note.brightness * 0.15;

    oscA.connect(mixGain);
    oscB.connect(mixGain);
    oscC.connect(mixGain);
    mixGain.connect(filter);

    if (note.distort) {
      const wsAmount = Math.min(52, Math.max(6, note.distortionAmount * 0.78));
      const ws = createWaveShaper(wsAmount);
      filter.connect(ws);
      ws.connect(masterGain);
    } else {
      filter.connect(masterGain);
    }

    const env = applyADSR(mixGain, when, {
      attack: 0.006,
      decay: 0.2 + note.duration * 0.14,
      sustain: 0.03,
      release: 0.35 + note.brightness * 0.12,
      peak: note.amplitude
    });

    oscA.start(when);
    oscB.start(when);
    oscC.start(when);

    const stopTime = when + duration + env.releaseTime + 0.05;
    releaseADSR(mixGain, when + duration, env.releaseTime);
    oscA.stop(stopTime);
    oscB.stop(stopTime);
    oscC.stop(stopTime);
  }

  const scheduler = {
    timerId: null,
    isPlaying: false,
    queue: [],
    nextIndex: 0,
    nextTime: 0,
    scheduleAheadTime: typeof opts.scheduleAheadTime === 'number' ? opts.scheduleAheadTime : 0.45,
    lookAhead: typeof opts.lookAhead === 'number' ? opts.lookAhead : 0.025,
    onNoteTimers: []
  };

  function clearPlaybackTimers() {
    while (scheduler.onNoteTimers.length > 0) {
      clearTimeout(scheduler.onNoteTimers.pop());
    }
  }

  function getRepresentativeValue(entry) {
    if (Array.isArray(entry.mergeEvents) && entry.mergeEvents.length > 0) {
      return Math.max(...entry.mergeEvents.map((merge) => merge.to));
    }
    if (entry.mergedValue && entry.mergedValue > 0) return entry.mergedValue;
    if (entry.maxTile) return entry.maxTile;
    return Math.max(...(entry.tileValues || [2]));
  }

  function composeHistoryNote(entry) {
    const direction = entry.moveDirection || 'left';
    const representativeValue = getRepresentativeValue(entry);
    const mergeWeight = Math.max(0, Math.log2(Math.max(2, entry.mergedValue || representativeValue)) - 1);
    const mergeCount = Array.isArray(entry.mergeEvents) ? entry.mergeEvents.length : entry.mergedValue > 0 ? 1 : 0;
    const directionInterval = DIRECTION_INTERVALS[direction] || 0;
    const rhythmBase = DIRECTION_RHYTHMS[direction] || 0.16;

    // These mappings document the 2048 heuristics that drive the recap score:
    // - Direction acts like monotonicity: vertical moves push interval color up/down,
    //   while horizontal moves tighten or relax rhythmic spacing.
    // - Larger merge totals act like board smoothness/payoff: they make notes longer,
    //   louder, and brighter so "better" consolidations feel more resolved.
    // - Multiple merges in one move add harmonic lift and distortion, mirroring the
    //   increased local complexity of the board at that moment.
    const spacing = rhythmBase + Math.min(0.12, mergeCount * 0.018);
    const duration = Math.min(0.75, 0.16 + mergeWeight * 0.04 + (direction === 'right' ? 0.08 : 0) + (direction === 'left' ? -0.03 : 0));
    const amplitude = Math.min(0.19, 0.08 + mergeWeight * 0.012 + mergeCount * 0.008);
    const brightness = Math.min(1.1, 0.22 + mergeWeight * 0.11);
    const harmonicLift = Math.min(1.25, mergeCount * 0.22 + (direction === 'up' ? 0.18 : 0));
    const distort = representativeValue >= (opts.distortThreshold || 32);
    const distortionAmount = 10 + mergeWeight * 7 + (direction === 'down' ? 4 : 0);
    const freq = valueToFreq(representativeValue, directionInterval);

    return {
      amplitude,
      brightness,
      direction,
      distort,
      distortionAmount,
      duration,
      freq,
      harmonicLift,
      spacing,
      value: representativeValue
    };
  }

  function schedulePlaybackNote(note, time) {
    if (muted) return;
    if (engine === 'fm') playFMSynth(note.freq, time, note.duration, note);
    else playSubtractive(note.freq, time, note.duration, note);
  }

  function emitScheduledNote(note, time, callback) {
    if (typeof callback !== 'function') return;
    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
    const timerId = window.setTimeout(() => {
      callback(note);
      scheduler.onNoteTimers = scheduler.onNoteTimers.filter((id) => id !== timerId);
    }, delayMs);
    scheduler.onNoteTimers.push(timerId);
  }

  function startHistoryPlayback(options = {}) {
    const onEnd = typeof options.onEnd === 'function' ? options.onEnd : null;
    const onNote = typeof options.onNote === 'function' ? options.onNote : null;
    const history = Array.isArray(options.history) && options.history.length > 0 ? options.history : gameHistory;

    if (!history || history.length === 0) return false;
    if (scheduler.isPlaying) return true;

    clearPlaybackTimers();
    scheduler.queue = history.slice();
    scheduler.nextIndex = 0;
    scheduler.isPlaying = true;
    scheduler.nextTime = ctx.currentTime + 0.08;

    scheduler.timerId = window.setInterval(() => {
      const now = ctx.currentTime;
      while (scheduler.nextIndex < scheduler.queue.length && scheduler.nextTime < now + scheduler.scheduleAheadTime) {
        const entry = scheduler.queue[scheduler.nextIndex];
        const note = composeHistoryNote(entry);
        const noteTime = scheduler.nextTime;

        schedulePlaybackNote(note, noteTime);
        emitScheduledNote(
          {
            ...note,
            entry,
            index: scheduler.nextIndex,
            total: scheduler.queue.length
          },
          noteTime,
          onNote
        );

        scheduler.nextTime += note.spacing;
        scheduler.nextIndex++;
      }

      if (scheduler.nextIndex >= scheduler.queue.length) {
        clearInterval(scheduler.timerId);
        scheduler.timerId = null;
        scheduler.isPlaying = false;
        if (onEnd) {
          const endDelay = Math.max(0, (scheduler.nextTime - ctx.currentTime) * 1000 + 120);
          const endTimerId = window.setTimeout(() => {
            onEnd();
            scheduler.onNoteTimers = scheduler.onNoteTimers.filter((id) => id !== endTimerId);
          }, endDelay);
          scheduler.onNoteTimers.push(endTimerId);
        }
      }
    }, scheduler.lookAhead * 1000);

    return true;
  }

  function stopHistoryPlayback() {
    if (scheduler.timerId) {
      clearInterval(scheduler.timerId);
      scheduler.timerId = null;
    }
    clearPlaybackTimers();
    scheduler.isPlaying = false;
  }

  return {
    playTileSound(valueOrPayload) {
      const value = typeof valueOrPayload === 'object' && valueOrPayload !== null
        ? valueOrPayload.value || valueOrPayload.to || valueOrPayload.from || 2
        : valueOrPayload;
      const numeric = Math.max(2, Number(value) || 2);
      const note = {
        amplitude: Math.min(0.17, 0.075 + Math.log2(numeric) * 0.008),
        brightness: Math.min(1, 0.25 + Math.log2(numeric) * 0.05),
        direction: 'merge',
        distort: numeric >= (opts.distortThreshold || 32),
        distortionAmount: 8 + Math.log2(numeric) * 4,
        duration: Math.min(0.45, 0.18 + Math.log2(numeric) * 0.02),
        freq: valueToFreq(numeric),
        harmonicLift: Math.min(1, Math.log2(numeric) * 0.05),
        value: numeric
      };
      const when = ctx.currentTime + 0.005;
      schedulePlaybackNote(note, when);
    },

    toggleEngine() {
      engine = engine === 'fm' ? 'subtractive' : 'fm';
      return engine;
    },

    getEngine() {
      return engine;
    },

    setMuted(value) {
      muted = !!value;
    },

    isMuted() {
      return muted;
    },

    async resume() {
      if (ctx.state === 'suspended') await ctx.resume();
    },

    startHistoryPlayback(options = {}) {
      return startHistoryPlayback(options);
    },

    stopHistoryPlayback() {
      stopHistoryPlayback();
    },

    _internal: { compressor, ctx, masterGain }
  };
}

export default createAudioEngine;
