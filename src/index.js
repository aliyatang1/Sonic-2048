import EventDispatcher from './eventDispatcher.js';
import Game, { gameHistory } from './game.js';
import { createAudioEngine } from './audio.js';

export { EventDispatcher, Game, gameHistory, createAudioEngine };

export function createApp() {
  const dispatcher = new EventDispatcher();
  const game = new Game(dispatcher);
  const audio = createAudioEngine({ gameHistory });
  game.reset();
  return { dispatcher, game, audio };
}
