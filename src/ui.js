import { createApp } from './index.js';

const app = createApp();
const { dispatcher, game, audio } = app;

const gridEl = document.getElementById('grid');
const scoreEl = document.getElementById('score');
const newBtn = document.getElementById('newGame');
const toggleSynthBtn = document.getElementById('toggleSynth');
const toggleAudioBtn = document.getElementById('toggleAudio');

let audioEnabled = !!audio;
if (!audioEnabled) {
  toggleAudioBtn.textContent = 'Audio Unavailable';
  toggleSynthBtn.textContent = 'Synth Unavailable';
  toggleAudioBtn.disabled = true;
  toggleSynthBtn.disabled = true;
} else {
  toggleSynthBtn.textContent = `Synth: ${audio.getEngine().toUpperCase()}`;
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
  setTimeout(() => alert(`Game Over — score ${p.score}`), 50);
});

createGrid();
render();
