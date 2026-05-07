import EventDispatcher from './eventDispatcher.js';

export const gameHistory = [];

export class Game {
  constructor(dispatcher = new EventDispatcher()) {
    this.dispatcher = dispatcher;
    this.size = 4;
    this.grid = new Array(this.size * this.size).fill(0);
    this.score = 0;
    this.isGameOver = false;
  }

  reset() {
    this.grid.fill(0);
    this.score = 0;
    this.isGameOver = false;
    gameHistory.length = 0;
    this.addRandomTile();
    this.addRandomTile();
    this.dispatcher.emit('GAME_RESET', { grid: this.getGrid() });
  }

  getGrid() {
    // return a copy as 2D array
    const out = [];
    for (let r = 0; r < this.size; r++) {
      out.push(this.grid.slice(r * this.size, r * this.size + this.size));
    }
    return out;
  }

  getFlat() {
    return this.grid.slice();
  }

  addRandomTile() {
    const empties = [];
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === 0) empties.push(i);
    if (empties.length === 0) return false;
    const idx = empties[Math.floor(Math.random() * empties.length)];
    this.grid[idx] = Math.random() < 0.9 ? 2 : 4;
    this.dispatcher.emit('TILE_SPAWN', { index: idx, value: this.grid[idx] });
    return true;
  }

  canMove() {
    // if any empty
    if (this.grid.some(v => v === 0)) return true;
    // horizontal merges
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size - 1; c++) {
        const a = this.grid[r * this.size + c];
        const b = this.grid[r * this.size + c + 1];
        if (a === b) return true;
      }
    }
    // vertical merges
    for (let c = 0; c < this.size; c++) {
      for (let r = 0; r < this.size - 1; r++) {
        const a = this.grid[r * this.size + c];
        const b = this.grid[(r + 1) * this.size + c];
        if (a === b) return true;
      }
    }
    return false;
  }

  move(direction) {
    if (this.isGameOver) {
      this.dispatcher.emit('MOVE_IGNORED', { direction, reason: 'game-over' });
      return false;
    }

    this.dispatcher.emit('MOVE_START', { direction, grid: this.getGrid() });
    let mergedTotal = 0;
    const mergeEvents = [];

    const moveRow = (row) => {
      const nums = row.filter(v => v !== 0);
      const out = [];
      for (let i = 0; i < nums.length; i++) {
        if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
          const merged = nums[i] * 2;
          out.push(merged);
          mergedTotal += merged;
          const mergeEvent = { from: nums[i], to: merged };
          mergeEvents.push(mergeEvent);
          this.dispatcher.emit('TILE_MERGE', mergeEvent);
          i++;
        } else {
          out.push(nums[i]);
        }
      }
      while (out.length < this.size) out.push(0);
      return out;
    };

    const newGrid = new Array(this.grid.length).fill(0);

    if (direction === 'left' || direction === 'right') {
      for (let r = 0; r < this.size; r++) {
        const row = this.grid.slice(r * this.size, r * this.size + this.size);
        const processed = moveRow(direction === 'left' ? row : row.slice().reverse());
        const finalRow = direction === 'left' ? processed : processed.slice().reverse();
        for (let c = 0; c < this.size; c++) newGrid[r * this.size + c] = finalRow[c];
      }
    } else if (direction === 'up' || direction === 'down') {
      for (let c = 0; c < this.size; c++) {
        const col = [];
        for (let r = 0; r < this.size; r++) col.push(this.grid[r * this.size + c]);
        const processed = moveRow(direction === 'up' ? col : col.slice().reverse());
        const finalCol = direction === 'up' ? processed : processed.slice().reverse();
        for (let r = 0; r < this.size; r++) newGrid[r * this.size + c] = finalCol[r];
      }
    } else {
      throw new Error('Invalid move direction');
    }

    const moved = newGrid.some((v, i) => v !== this.grid[i]);
    if (!moved) {
      this.dispatcher.emit('MOVE_IGNORED', { direction });
      return false;
    }

    this.grid = newGrid;
    this.score += mergedTotal;

    // push history
    const entry = {
      moveDirection: direction,
      tileValues: this.getFlat(),
      mergedValue: mergedTotal,
      mergeEvents,
      maxTile: Math.max(...this.grid),
      timestamp: Date.now()
    };
    gameHistory.push(entry);
    this.dispatcher.emit('MOVE_END', { direction, mergedTotal, grid: this.getGrid(), historyEntry: entry });

    // spawn a new tile after a successful move
    this.addRandomTile();

    if (!this.canMove()) {
      this.isGameOver = true;
      this.dispatcher.emit('GAME_OVER', { score: this.score, grid: this.getGrid() });
    }
    return true;
  }
}

export default Game;
