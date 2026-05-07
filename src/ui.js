import { createApp, gameHistory } from './index.js';

const app = createApp();
const { dispatcher, game, audio } = app;

const gridEl = document.getElementById('grid');
const scoreEl = document.getElementById('score');
const newBtn = document.getElementById('newGame');
const toggleSynthBtn = document.getElementById('toggleSynth');
const toggleAudioBtn = document.getElementById('toggleAudio');
const playbackEl = document.getElementById('playbackIndicator');
const recapPanelEl = document.getElementById('recapPanel');
const recapScoreEl = document.getElementById('recapScore');
const recapStatusEl = document.getElementById('recapStatus');
const recapMovesEl = document.getElementById('recapMoves');
const recapTopTileEl = document.getElementById('recapTopTile');
const recapCurrentMoveEl = document.getElementById('recapCurrentMove');
const replayRecapBtn = document.getElementById('replayRecap');

let recapPulseTimerId = null;
let recapState = {
  active: false,
  finalGrid: [],
  history: [],
  playing: false,
  score: 0
};

let audioEnabled = !!audio;
if (audio && audio.setMuted) audio.setMuted(!audioEnabled);

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

function cloneHistorySnapshot(history) {
  return history.map((entry) => ({
    ...entry,
    tileValues: Array.isArray(entry.tileValues) ? entry.tileValues.slice() : [],
    mergeEvents: Array.isArray(entry.mergeEvents) ? entry.mergeEvents.map((merge) => ({ ...merge })) : []
  }));
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

function renderBoard(flat) {
  for (let i = 0; i < flat.length; i++) {
    const cell = gridEl.children[i];
    const value = flat[i];
    if (value === 0) {
      cell.className = 'cell empty';
      cell.textContent = '';
    } else {
      cell.className = `cell v${value}`;
      cell.textContent = value;
    }
  }
}

function render() {
  renderBoard(game.getFlat());
  scoreEl.textContent = String(game.score);
}

function updatePlaybackIndicator(isPlaying) {
  if (!playbackEl) return;
  playbackEl.textContent = isPlaying ? 'Playback: On' : 'Playback: Off';
  playbackEl.classList.toggle('off', !isPlaying);
  playbackEl.setAttribute('aria-hidden', isPlaying ? 'false' : 'true');
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

function formatDirection(direction) {
  if (!direction) return 'Hold';
  return direction.charAt(0).toUpperCase() + direction.slice(1);
}

function getTopTile(flat) {
  return flat.length > 0 ? Math.max(...flat) : 0;
}

function hideRecapPanel() {
  recapState = {
    active: false,
    finalGrid: [],
    history: [],
    playing: false,
    score: 0
  };
  gridEl.classList.remove('recap-board');
  if (recapPanelEl) recapPanelEl.hidden = true;
  if (replayRecapBtn) replayRecapBtn.disabled = false;
  if (recapStatusEl) recapStatusEl.textContent = 'Playback is ready.';
  if (recapCurrentMoveEl) recapCurrentMoveEl.textContent = 'Waiting to replay.';
}

function showRecapPanel({ score, history, finalGrid }) {
  recapState = {
    active: true,
    finalGrid: finalGrid.slice(),
    history: cloneHistorySnapshot(history),
    playing: false,
    score
  };

  gridEl.classList.add('recap-board');
  renderBoard(finalGrid);

  if (recapPanelEl) recapPanelEl.hidden = false;
  if (recapScoreEl) recapScoreEl.textContent = String(score);
  if (recapMovesEl) recapMovesEl.textContent = String(history.length);
  if (recapTopTileEl) recapTopTileEl.textContent = String(getTopTile(finalGrid));
  if (recapStatusEl) recapStatusEl.textContent = history.length > 0 ? 'Playback queued from your final run.' : 'No moves were recorded for playback.';
  if (recapCurrentMoveEl) recapCurrentMoveEl.textContent = history.length > 0 ? 'Ready to replay the final sequence.' : 'No recap available.';
  if (replayRecapBtn) replayRecapBtn.disabled = history.length === 0;
}

function finishRecapPlayback() {
  recapState.playing = false;
  clearRecapPulse();
  updatePlaybackIndicator(false);
  if (recapStatusEl) {
    recapStatusEl.textContent = audioEnabled
      ? 'Playback complete. Replay the score or start a new game.'
      : 'Visual playback complete. Turn audio back on to hear the score next time.';
  }
  if (recapCurrentMoveEl) recapCurrentMoveEl.textContent = 'Final phrase resolved.';
  if (replayRecapBtn) replayRecapBtn.disabled = recapState.history.length === 0;
  if (recapState.finalGrid.length > 0) renderBoard(recapState.finalGrid);
}

function startRecapPlayback() {
  if (!recapState.active || recapState.history.length === 0) return;

  if (audio && audio.stopHistoryPlayback) audio.stopHistoryPlayback();
  if (audio && audio.resume) audio.resume();

  recapState.playing = true;
  updatePlaybackIndicator(true);
  if (replayRecapBtn) replayRecapBtn.disabled = true;
  if (recapStatusEl) {
    recapStatusEl.textContent = audioEnabled
      ? 'Replaying your final score in sync with the board.'
      : 'Audio is muted, but the recap visuals are replaying in sync.';
  }
  if (recapCurrentMoveEl) recapCurrentMoveEl.textContent = 'Preparing opening phrase...';

  if (!audio || !audio.startHistoryPlayback) {
    finishRecapPlayback();
    return;
  }

  const started = audio.startHistoryPlayback({
    history: recapState.history,
    onEnd: () => {
      finishRecapPlayback();
    },
    onNote: (note) => {
      pulseRecap(note.direction, note.duration);
      if (Array.isArray(note.entry?.tileValues) && note.entry.tileValues.length === 16) {
        renderBoard(note.entry.tileValues);
      }
      if (recapCurrentMoveEl) {
        const mergeLabel = note.entry?.mergedValue ? `merge ${note.entry.mergedValue}` : 'no merge';
        recapCurrentMoveEl.textContent = `${formatDirection(note.direction)} move ${note.index + 1} of ${note.total}, ${mergeLabel}.`;
      }
    }
  });

  if (!started) finishRecapPlayback();
}

function playMergeSound(value) {
  if (!audio || !audioEnabled) return;
  try {
    audio.playTileSound(value);
  } catch (error) {
    console.warn('Audio play error', error);
  }
}

window.addEventListener('keydown', (event) => {
  if (recapState.playing) {
    event.preventDefault();
    return;
  }

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

  const direction = map[event.key];
  if (direction) {
    const moved = game.move(direction);
    if (moved && !recapState.active) render();
    event.preventDefault();
  }
});

newBtn.addEventListener('click', () => {
  if (audio && audio.stopHistoryPlayback) audio.stopHistoryPlayback();
  clearRecapPulse();
  updatePlaybackIndicator(false);
  hideRecapPanel();
  game.reset();
  render();
  if (audio && audio.resume) audio.resume();
});

toggleAudioBtn.addEventListener('click', () => {
  if (!audio) return;
  audioEnabled = !audioEnabled;
  if (audio.setMuted) audio.setMuted(!audioEnabled);
  toggleAudioBtn.textContent = audioEnabled ? 'Audio: On' : 'Audio: Off';
  if (audioEnabled && audio.resume) audio.resume();
  if (recapState.active && !recapState.playing && recapStatusEl) {
    recapStatusEl.textContent = audioEnabled ? 'Playback is ready.' : 'Playback is ready, and audio is muted.';
  }
});

toggleSynthBtn.addEventListener('click', () => {
  if (!audio) return;
  const mode = audio.toggleEngine();
  toggleSynthBtn.textContent = `Synth: ${mode.toUpperCase()}`;
  if (audio.resume) audio.resume();
});

if (replayRecapBtn) {
  replayRecapBtn.addEventListener('click', () => {
    startRecapPlayback();
  });
}

dispatcher.on('GAME_RESET', () => {
  hideRecapPanel();
  updatePlaybackIndicator(false);
});

dispatcher.on('MOVE_END', () => {
  if (!recapState.active) render();
});

dispatcher.on('TILE_MERGE', (payload) => {
  playMergeSound(payload);
});

dispatcher.on('GAME_OVER', (payload) => {
  clearRecapPulse();
  showRecapPanel({
    score: payload.score,
    history: cloneHistorySnapshot(gameHistory),
    finalGrid: game.getFlat()
  });

  try {
    startRecapPlayback();
  } catch (error) {
    console.warn('History playback error', error);
    finishRecapPlayback();
  }
});

createGrid();
hideRecapPanel();
render();
