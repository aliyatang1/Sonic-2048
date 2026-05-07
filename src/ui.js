import { createApp } from './index.js';

const app = createApp();
const { dispatcher, game, audio } = app;

const gridEl = document.getElementById('grid');
const scoreEl = document.getElementById('score');
const newBtn = document.getElementById('newGame');
const toggleSynthBtn = document.getElementById('toggleSynth');
const toggleAudioBtn = document.getElementById('toggleAudio');
const playbackEl = document.getElementById('playbackIndicator');
let recapPulseTimerId = null;

let audioEnabled = !!audio;
if (!audioEnabled) {
  toggleAudioBtn.textContent = 'Audio Unavailable';
  toggleSynthBtn.textContent = 'Synth Unavailable';
  toggleAudioBtn.disabled = true;
  toggleSynthBtn.disabled = true;
  if (playbackEl) {
    playbackEl.textContent = 'Playback: Unavailable';
    playbackEl.classList.add('off');
    playbackEl.setAttribute('aria-hidden', 'true');
  }
} else {
  toggleSynthBtn.textContent = `Synth: ${audio.getEngine().toUpperCase()}`;
  if (playbackEl) {
    playbackEl.textContent = 'Playback: Off';
    playbackEl.classList.add('off');
    playbackEl.setAttribute('aria-hidden', 'true');
  }
}

function createGrid() {
  gridEl.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell empty';
    cell.dataset.index = i;
    gridEl.appendChild(cell);
  }
}

function render() {
  const flat = game.getFlat();
  for (let i = 0; i < flat.length; i++) {
    const cell = gridEl.children[i];
    const v = flat[i];
    if (v === 0) {
      cell.className = 'cell empty';
      cell.textContent = '';
    } else {
      const cls = `cell v${v}`;
      cell.className = cls;
      cell.textContent = v;
    }
  }
  scoreEl.textContent = String(game.score);
}

function clearRecapPulse() {
  if (recapPulseTimerId) {
    clearTimeout(recapPulseTimerId);
    recapPulseTimerId = null;
  }
  gridEl.dataset.recapDirection = '';
  gridEl.classList.remove('recap-pulse');
}

function pulseRecap(direction, duration = 0.18) {
  clearRecapPulse();
  gridEl.dataset.recapDirection = direction || 'left';
  gridEl.classList.add('recap-pulse');
  recapPulseTimerId = window.setTimeout(() => {
    gridEl.classList.remove('recap-pulse');
    gridEl.dataset.recapDirection = '';
    recapPulseTimerId = null;
  }, Math.max(120, duration * 1000));
}

function playMergeSound(value) {
  if (!audio || !audioEnabled) return;
  try {
    audio.playTileSound(value);
  } catch (e) {
    console.warn('Audio play error', e);
  }
}

// keyboard input
window.addEventListener('keydown', (e) => {
  const map = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    a: 'left',
    d: 'right',
    w: 'up',
    s: 'down'
  };
  const dir = map[e.key];
  if (dir) {
    const moved = game.move(dir);
    if (moved) render();
    e.preventDefault();
  }
});

newBtn.addEventListener('click', () => {
  if (audio && audio.stopHistoryPlayback) audio.stopHistoryPlayback();
  clearRecapPulse();
  if (playbackEl) {
    playbackEl.textContent = 'Playback: Off';
    playbackEl.classList.add('off');
    playbackEl.setAttribute('aria-hidden', 'true');
  }
  game.reset();
  render();
  if (audio && audio.resume) audio.resume();
});

toggleAudioBtn.addEventListener('click', () => {
  if (!audio) return;
  audioEnabled = !audioEnabled;
  toggleAudioBtn.textContent = audioEnabled ? 'Audio: On' : 'Audio: Off';
  if (audioEnabled && audio.resume) audio.resume();
});

toggleSynthBtn.addEventListener('click', () => {
  if (!audio) return;
  const mode = audio.toggleEngine();
  toggleSynthBtn.textContent = `Synth: ${mode.toUpperCase()}`;
  if (audio.resume) audio.resume();
});

// subscribe to game events
dispatcher.on('MOVE_END', () => render());
dispatcher.on('TILE_MERGE', (p) => {
  // pass full merge info so audio engine can vary timbre based on both tiles
  playMergeSound(p);
});
dispatcher.on('GAME_OVER', (p) => {
  // play back the game history as a final score melody, indicate playback in UI
  if (!playbackEl) {
    setTimeout(() => alert(`Game Over — score ${p.score}`), 50);
    return;
  }
  playbackEl.textContent = 'Playback: On';
  playbackEl.classList.remove('off');
  playbackEl.setAttribute('aria-hidden', 'false');

  try {
    if (audio && audio.startHistoryPlayback) {
      const started = audio.startHistoryPlayback({
        onEnd: () => {
          clearRecapPulse();
          playbackEl.textContent = 'Playback: Off';
          playbackEl.classList.add('off');
          playbackEl.setAttribute('aria-hidden', 'true');
          setTimeout(() => alert(`Game Over — score ${p.score}`), 50);
        },
        onNote: (note) => {
          pulseRecap(note.direction, note.duration);
        }
      });
      if (!started) {
        // nothing to play
        clearRecapPulse();
        playbackEl.textContent = 'Playback: Off';
        playbackEl.classList.add('off');
        playbackEl.setAttribute('aria-hidden', 'true');
        setTimeout(() => alert(`Game Over — score ${p.score}`), 50);
      }
    } else {
      clearRecapPulse();
      setTimeout(() => alert(`Game Over — score ${p.score}`), 50);
    }
  } catch (e) {
    console.warn('History playback error', e);
    clearRecapPulse();
    playbackEl.textContent = 'Playback: Off';
    playbackEl.classList.add('off');
    playbackEl.setAttribute('aria-hidden', 'true');
    setTimeout(() => alert(`Game Over — score ${p.score}`), 50);
  }
});

createGrid();
render();
