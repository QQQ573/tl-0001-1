export type CardType = 'attack' | 'defense' | 'reflect' | 'control' | 'special';

export type EffectType =
  | 'deal_embarrassment'
  | 'reduce_embarrassment'
  | 'gain_immunity'
  | 'gain_reflect'
  | 'draw_cards'
  | 'discard_enemy'
  | 'skip_next_effect'
  | 'multiply_damage'
  | 'reduce_cost'
  | 'extra_turn_card';

export type Target = 'self' | 'enemy';

export interface CardEffect {
  effectType: EffectType;
  target: Target;
  value: number;
  duration?: number;
  applyToNext?: number;
}

export interface CardData {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  speed: number;
  description: string;
  effects: CardEffect[];
  exclusiveWith: (CardType | string)[];
}

export interface DeckEntry {
  cardId: string;
  count: number;
}

export interface GameConfig {
  maxEmbarrassment: number;
  startEmbarrassment: number;
  startHandSize: number;
  maxHandSize: number;
  turnTimeLimit: number;
  cardsPerTurn: number;
  maxCardsPerTurn: number;
}

export interface CardDataBundle {
  gameConfig: GameConfig;
  cardTypes: CardType[];
  effectTypes: EffectType[];
  cards: CardData[];
  decks: Record<string, DeckEntry[]>;
}

export type PlayerId = 'player' | 'enemy';

export interface ActiveEffect {
  effectType: EffectType;
  value: number;
  remainingDuration: number;
  remainingUses?: number;
  sourceCardId: string;
}

export interface PlayerState {
  id: PlayerId;
  embarrassment: number;
  hand: string[];
  deck: string[];
  discardPile: string[];
  activeEffects: ActiveEffect[];
  cardsPlayedThisTurn: number;
  extraCardsThisTurn: number;
  isAI: boolean;
}

export type GamePhase = 'start' | 'playing' | 'turn_start' | 'main_phase' | 'resolving' | 'turn_end' | 'game_over';

export interface PlayedCard {
  cardId: string;
  owner: PlayerId;
  resolved: boolean;
  resolutionOrder: number;
}

export interface GameState {
  phase: GamePhase;
  currentTurn: PlayerId;
  turnNumber: number;
  players: Record<PlayerId, PlayerState>;
  playedCardsThisTurn: PlayedCard[];
  winner: PlayerId | null;
  turnTimeRemaining: number;
  log: GameLogEntry[];
}

export interface GameLogEntry {
  turn: number;
  message: string;
  type: 'info' | 'attack' | 'defense' | 'effect' | 'system';
}

export type AIStyle = 'conservative' | 'balanced' | 'aggressive';
