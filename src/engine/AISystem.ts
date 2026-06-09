import type { GameState, AIStyle, PlayerId, CardData, CardEffect } from '../types';
import { cardRepo } from './CardRepository';

interface CardEvaluation {
  cardId: string;
  score: number;
  expectedValue: number;
  costEfficiency: number;
}

export class AISystem {
  private style: AIStyle;

  constructor(style: AIStyle = 'balanced') {
    this.style = style;
  }

  chooseCardsToPlay(state: GameState): string[] {
    const aiPlayer = state.players.enemy;
    const config = cardRepo.getConfig();
    const maxCards = config.cardsPerTurn + aiPlayer.extraCardsThisTurn;

    const playableCards = this.getPlayableCards(state, 'enemy');
    if (playableCards.length === 0) return [];

    const evaluations = playableCards.map((cardId) =>
      this.evaluateCard(cardId, state)
    );

    evaluations.sort((a, b) => b.score - a.score);

    const selectedCards: string[] = [];
    const selectedTypes = new Set<string>();
    const selectedIds = new Set<string>();
    let totalCost = 0;

    for (const evalCard of evaluations) {
      if (selectedCards.length >= maxCards) break;

      const card = cardRepo.getCard(evalCard.cardId);
      if (totalCost + card.cost > aiPlayer.embarrassment) continue;

      let hasConflict = false;
      for (const exclusiveItem of card.exclusiveWith) {
        if (selectedTypes.has(exclusiveItem) || selectedIds.has(exclusiveItem)) {
          hasConflict = true;
          break;
        }
      }
      if (hasConflict) continue;

      selectedCards.push(evalCard.cardId);
      selectedTypes.add(card.type);
      selectedIds.add(card.id);
      totalCost += card.cost;
    }

    return this.reorderBySpeed(selectedCards);
  }

  private reorderBySpeed(cardIds: string[]): string[] {
    return [...cardIds].sort((a, b) => {
      const cardA = cardRepo.getCard(a);
      const cardB = cardRepo.getCard(b);
      return cardB.speed - cardA.speed;
    });
  }

  private evaluateCard(cardId: string, state: GameState): CardEvaluation {
    const card = cardRepo.getCard(cardId);
    const aiPlayer = state.players.enemy;
    const humanPlayer = state.players.player;

    let expectedValue = 0;

    for (const effect of card.effects) {
      expectedValue += this.evaluateEffect(effect, state, aiPlayer, humanPlayer);
    }

    const costEfficiency = card.cost > 0 ? expectedValue / card.cost : expectedValue;
    const styleModifier = this.getStyleModifier(card);
    const score = expectedValue * styleModifier + costEfficiency * 0.5;

    return {
      cardId,
      score,
      expectedValue,
      costEfficiency,
    };
  }

  private evaluateEffect(
    effect: CardEffect,
    _state: GameState,
    aiPlayer: GameState['players']['enemy'],
    humanPlayer: GameState['players']['player']
  ): number {
    const config = cardRepo.getConfig();

    switch (effect.effectType) {
      case 'deal_embarrassment': {
        const damageValue = effect.value * 1.2;
        const killBonus = humanPlayer.embarrassment + effect.value >= config.maxEmbarrassment ? 30 : 0;
        return damageValue + killBonus;
      }
      case 'reduce_embarrassment': {
        const healValue = effect.value;
        const survivalBonus = aiPlayer.embarrassment > config.maxEmbarrassment * 0.7
          ? effect.value * 1.5
          : 0;
        return healValue + survivalBonus;
      }
      case 'gain_immunity': {
        const urgency = humanPlayer.embarrassment > config.maxEmbarrassment * 0.6 ? 1.5 : 1;
        return 12 * (effect.value > 10 ? 2 : 1) * urgency;
      }
      case 'gain_reflect': {
        const reflectValue = 15 * effect.value;
        const urgency = humanPlayer.embarrassment > config.maxEmbarrassment * 0.5 ? 1.3 : 1;
        return reflectValue * urgency;
      }
      case 'draw_cards': {
        return effect.value * 8;
      }
      case 'discard_enemy': {
        return effect.value * 10;
      }
      case 'multiply_damage': {
        return (1 - effect.value) * 15;
      }
      case 'extra_turn_card': {
        return effect.value * 20;
      }
      default:
        return 0;
    }
  }

  private getStyleModifier(card: CardData): number {
    switch (this.style) {
      case 'conservative':
        if (card.type === 'defense') return 1.5;
        if (card.type === 'reflect') return 1.3;
        if (card.type === 'attack') return 0.7;
        if (card.type === 'control') return 1.1;
        return 1;
      case 'aggressive':
        if (card.type === 'attack') return 1.6;
        if (card.type === 'control') return 1.2;
        if (card.type === 'defense') return 0.6;
        if (card.type === 'special') return 0.9;
        return 1;
      case 'balanced':
      default:
        return 1;
    }
  }

  private getPlayableCards(state: GameState, playerId: PlayerId): string[] {
    const player = state.players[playerId];
    const config = cardRepo.getConfig();
    const maxCards = config.cardsPerTurn + player.extraCardsThisTurn;

    if (player.cardsPlayedThisTurn >= maxCards) {
      return [];
    }

    return player.hand.filter((cardId) => {
      const card = cardRepo.getCard(cardId);
      if (player.embarrassment < card.cost) return false;

      const playedThisTurn = state.playedCardsThisTurn.filter(
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

  evaluateHandStrength(state: GameState, playerId: PlayerId): number {
    const player = state.players[playerId];
    let totalValue = 0;

    for (const cardId of player.hand) {
      const card = cardRepo.getCard(cardId);
      let value = 0;
      for (const effect of card.effects) {
        value += Math.abs(effect.value);
      }
      totalValue += value;
    }

    return totalValue;
  }
}
