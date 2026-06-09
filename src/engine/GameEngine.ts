import type { GameState, PlayerId, PlayerState, AIStyle, CardData } from '../types';
import { cardRepo } from './CardRepository';
import { EffectEngine } from './EffectEngine';
import { AISystem } from './AISystem';

export class GameEngine {
  private state: GameState;
  private effectEngine: EffectEngine;
  private aiSystem: AISystem;
  private aiStyle: AIStyle;
  private turnTimer: number | null = null;
  private onStateChange: ((state: GameState) => void) | null = null;

  constructor(aiStyle: AIStyle = 'balanced') {
    this.aiStyle = aiStyle;
    this.state = this.createInitialState();
    this.effectEngine = new EffectEngine(this.state);
    this.aiSystem = new AISystem(aiStyle);
  }

  private createInitialState(): GameState {
    const config = cardRepo.getConfig();
    const playerDeck = cardRepo.shuffleDeck(cardRepo.getDeck('standard'));
    const enemyDeck = cardRepo.shuffleDeck(cardRepo.getDeck('standard'));

    const playerState: PlayerState = {
      id: 'player',
      embarrassment: config.startEmbarrassment,
      hand: [],
      deck: playerDeck,
      discardPile: [],
      activeEffects: [],
      cardsPlayedThisTurn: 0,
      extraCardsThisTurn: 0,
      isAI: false,
    };

    const enemyState: PlayerState = {
      id: 'enemy',
      embarrassment: config.startEmbarrassment,
      hand: [],
      deck: enemyDeck,
      discardPile: [],
      activeEffects: [],
      cardsPlayedThisTurn: 0,
      extraCardsThisTurn: 0,
      isAI: true,
    };

    const state: GameState = {
      phase: 'start',
      currentTurn: 'player',
      turnNumber: 1,
      players: {
        player: playerState,
        enemy: enemyState,
      },
      playedCardsThisTurn: [],
      winner: null,
      turnTimeRemaining: config.turnTimeLimit,
      log: [],
    };

    return state;
  }

  startGame(): GameState {
    const config = cardRepo.getConfig();

    for (let i = 0; i < config.startHandSize; i++) {
      this.drawCard('player');
      this.drawCard('enemy');
    }

    this.state.phase = 'playing';
    this.effectEngine.startTurn('player');
    this.startTurnTimer();

    this.notifyStateChange();
    return this.getState();
  }

  playCard(cardId: string, playerId: PlayerId = 'player'): { success: boolean; reason?: string } {
    if (this.state.phase !== 'main_phase') {
      return { success: false, reason: '当前阶段不能出牌' };
    }

    if (this.state.currentTurn !== playerId) {
      return { success: false, reason: '不是你的回合' };
    }

    const result = this.effectEngine.playCard(cardId, playerId);

    if (result.success) {
      this.checkGameOver();
      this.notifyStateChange();
    }

    return result;
  }

  endTurn(playerId: PlayerId = 'player'): GameState {
    if (this.state.currentTurn !== playerId) {
      return this.getState();
    }

    this.stopTurnTimer();
    this.effectEngine.endTurn();

    if (this.state.phase === 'game_over') {
      this.notifyStateChange();
      return this.getState();
    }

    if (this.state.currentTurn === 'enemy') {
      setTimeout(() => this.executeAITurn(), 800);
    } else {
      this.startTurnTimer();
    }

    this.notifyStateChange();
    return this.getState();
  }

  private executeAITurn(): void {
    if (this.state.phase === 'game_over') return;

    const cardsToPlay = this.aiSystem.chooseCardsToPlay(this.state);

    let delay = 500;
    for (const cardId of cardsToPlay) {
      setTimeout(() => {
        if (this.state.phase === 'game_over') return;
        this.effectEngine.playCard(cardId, 'enemy');
        this.checkGameOver();
        this.notifyStateChange();
      }, delay);
      delay += 600;
    }

    setTimeout(() => {
      if (this.state.phase === 'game_over') return;
      this.stopTurnTimer();
      this.effectEngine.endTurn();
      this.checkGameOver();

      if (this.state.currentTurn === 'player' && (this.state.phase as string) !== 'game_over') {
        this.startTurnTimer();
      }

      this.notifyStateChange();
    }, delay + 500);
  }

  setTimeoutTurn(): void {
    if (this.state.phase === 'game_over') return;

    const currentPlayer = this.state.currentTurn;

    if (currentPlayer === 'player') {
      const player = this.state.players.player;
      if (player.hand.length > 0) {
        const playable = this.getPlayableCards('player');
        if (playable.length > 0) {
          const defaultCard = playable[0];
          this.effectEngine.playCard(defaultCard, 'player');
          this.state.log.push({
            turn: this.state.turnNumber,
            message: '超时！自动出一张牌',
            type: 'system',
          });
        }
      }
      this.endTurn('player');
    }
  }

  getPlayableCards(playerId: PlayerId): string[] {
    const player = this.state.players[playerId];
    const config = cardRepo.getConfig();
    const maxCards = config.cardsPerTurn + player.extraCardsThisTurn;

    if (player.cardsPlayedThisTurn >= maxCards) {
      return [];
    }

    return player.hand.filter((cardId) => {
      const card = cardRepo.getCard(cardId);
      if (player.embarrassment < card.cost) return false;

      const playedThisTurn = this.state.playedCardsThisTurn.filter(
        (pc) => pc.owner === playerId
      );

      for (const played of playedThisTurn) {
        const playedCard = cardRepo.getCard(played.cardId);
        if (card.exclusiveWith.includes(playedCard.type)) return false;
        if (card.exclusiveWith.includes(playedCard.id)) return false;
        if (playedCard.exclusiveWith.includes(card.type)) return false;
        if (playedCard.exclusiveWith.includes(card.id)) return false;
      }

      return true;
    });
  }

  private drawCard(playerId: PlayerId): void {
    const player = this.state.players[playerId];
    this.effectEngine.drawCards(player, 1);
  }

  private checkGameOver(): void {
    const config = cardRepo.getConfig();
    for (const playerId of ['player', 'enemy'] as PlayerId[]) {
      if (this.state.players[playerId].embarrassment >= config.maxEmbarrassment) {
        this.state.phase = 'game_over';
        this.state.winner = playerId === 'player' ? 'enemy' : 'player';
        this.stopTurnTimer();
        return;
      }
    }
  }

  private startTurnTimer(): void {
    this.stopTurnTimer();
    const config = cardRepo.getConfig();
    this.state.turnTimeRemaining = config.turnTimeLimit;

    const interval = setInterval(() => {
      if (this.state.phase !== 'main_phase') {
        this.stopTurnTimer();
        return;
      }

      this.state.turnTimeRemaining -= 1;
      if (this.state.turnTimeRemaining <= 0) {
        this.stopTurnTimer();
        this.setTimeoutTurn();
      }
      this.notifyStateChange();
    }, 1000);

    this.turnTimer = interval as unknown as number;
  }

  private stopTurnTimer(): void {
    if (this.turnTimer !== null) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }
  }

  setStateChangeListener(listener: (state: GameState) => void): void {
    this.onStateChange = listener;
  }

  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  getState(): GameState {
    return JSON.parse(JSON.stringify(this.state));
  }

  getCardData(cardId: string): CardData {
    return cardRepo.getCard(cardId);
  }

  destroy(): void {
    this.stopTurnTimer();
  }

  getAIStyle(): AIStyle {
    return this.aiStyle;
  }
}
