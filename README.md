# Implementation Checklist: Sonic 2048
Aliya Tang and Siying Ding 

## Phase 1: Core Infrastructure (The Foundation)
* [x] **Game Logic Integration**: Set up standard 2048 grid logic (4x4).
* [x] **Event Dispatcher**: Create a system where the game "broadcasts" events (e.g., `MOVE_START`, `TILE_MERGE`, `GAME_OVER`).
* [x] **State Tracking (The "History" Array)**: 
    * Create a global `gameHistory` array.
    * Push an object for every move: `{moveDirection, tileValues, mergedValue, timestamp}`.
* [x] **WebAudio Boilerplate**: Initialize `AudioContext` and a Master Output chain with a `DynamicsCompressorNode` to prevent clipping during simultaneous merges.

## Phase 2: The Synthesis Engine (DSP & Class Concepts)
* [x] **FM Synthesis Module (Primary Class Concept)**:
    * Build a Carrier and Modulator oscillator pair.
    * Map Tile Value to **Modulation Index** (higher tiles = more harmonic complexity).
    * Map Tile Value to **Carrier Frequency** (assigning notes from a specific scale).
* [x] **Sound Board Factory**: 
    * Implement a secondary **Subtractive Synthesis** mode (Sawtooth waves + Filters).
    * Create a toggle to hot-swap between FM and Subtractive engines in real-time.
* [x] **Envelope Control**: Use `GainNodes` with `exponentialRampToValueAtTime` to create smooth "pops" for merges and avoid audio clicks.

## Phase 3: The "Topic Not Covered" (WaveShaper & Scheduling)
* [x] **WaveShaperNode Implementation**:
    * Design a distortion curve to add "grit" and character to specific sound boards.
    * Use this to differentiate the "texture" of high-value tiles.
* [x] **The Look-Ahead Scheduler**:
    * Implement a scheduling loop (the "Chris Wilson" method) using `setInterval` to check the `gameHistory`.
    * Use `AudioContext.currentTime` to schedule notes with sample-accurate precision for the final score playback.

## Phase 4: Automated Composition (The Final Score)
* [x] **The Mapping Logic**:
    * Assign move directions to musical intervals (e.g., Up/Down = Pitch shifts, Left/Right = Rhythmic variations).
    * Map merge values to volume and duration.
* [x] **The "Recap" UI**:
    * Create a playback mode that triggers at the end of the game.
    * Ensure the visual grid or UI "pulses" in sync with the audio playback using the scheduler.

## Phase 5: Quality & Rubrics (The Grade)
* [x] **Modular Code**: Ensure audio logic is encapsulated in its own class or module to avoid "spaghetti code."
* [x] **Commenting**: Document the specific "Game Theory" heuristics (like Monotonicity or Smoothness) used to control audio parameters.
* [x] **Final Polish**: Check that the transition between "Game Mode" and "Playback Mode" is seamless.
