import type {
  CardEffect,
  GameState,
  PlayerId,
  PlayerState,
  ActiveEffect,
  CardData,
  GameLogEntry,
} from '../types';
import { cardRepo } from './CardRepository';

export interface EffectResolutionResult {
  state: GameState;
  applied: boolean;
  finalValue: number;
  reflected: boolean;
  immunized: boolean;
}

export class EffectEngine {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  getState(): GameState {
    return this.state;
  }

  playCard(cardId: string, playerId: PlayerId): { success: boolean; reason?: string } {
    const player = this.state.players[playerId];
    const card = cardRepo.getCard(cardId);
    const config = cardRepo.getConfig();

    const maxCards = config.cardsPerTurn + player.extraCardsThisTurn;
    if (player.cardsPlayedThisTurn >= maxCards) {
      return { success: false, reason: '已达到本回合出牌上限' };
    }

    if (player.embarrassment < card.cost) {
      return { success: false, reason: '尴尬值不足' };
    }

    const exclusiveConflict = this.checkExclusiveConflict(card, playerId);
    if (exclusiveConflict) {
      return { success: false, reason: `与已出牌互斥: ${exclusiveConflict}` };
    }

    const handIndex = player.hand.indexOf(cardId);
    if (handIndex === -1) {
      return { success: false, reason: '手牌中没有此牌' };
    }

    player.hand.splice(handIndex, 1);
    player.embarrassment -= card.cost;
    player.cardsPlayedThisTurn += 1;

    this.state.playedCardsThisTurn.push({
      cardId,
      owner: playerId,
      resolved: false,
      resolutionOrder: 0,
    });

    this.addLog(playerId, `打出了【${card.name}】`, 'info');

    this.applyImmediateEffects(card, playerId);

    return { success: true };
  }

  private applyImmediateEffects(card: CardData, playerId: PlayerId): void {
    for (const effect of card.effects) {
      const target = effect.target === 'self' ? playerId : this.getOpponent(playerId);
      switch (effect.effectType) {
        case 'extra_turn_card':
          this.resolveExtraTurnCard(effect, target);
          break;
        case 'draw_cards':
          this.resolveDrawCards(effect, target);
          break;
        case 'discard_enemy':
          this.resolveDiscardEnemy(effect, target);
          break;
        default:
          break;
      }
    }
  }

  private checkExclusiveConflict(card: CardData, playerId: PlayerId): string | null {
    const playedThisTurn = this.state.playedCardsThisTurn.filter(
      (pc) => pc.owner === playerId
    );

    for (const played of playedThisTurn) {
      const playedCard = cardRepo.getCard(played.cardId);
      if (card.exclusiveWith.includes(playedCard.type)) {
        return playedCard.name;
      }
      if (card.exclusiveWith.includes(playedCard.id)) {
        return playedCard.name;
      }
      if (playedCard.exclusiveWith.includes(card.type)) {
        return playedCard.name;
      }
      if (playedCard.exclusiveWith.includes(card.id)) {
        return playedCard.name;
      }
    }
    return null;
  }

  resolveTurnEffects(): GameState {
    const sortedCards = [...this.state.playedCardsThisTurn].sort((a, b) => {
      const cardA = cardRepo.getCard(a.cardId);
      const cardB = cardRepo.getCard(b.cardId);
      return cardB.speed - cardA.speed;
    });

    sortedCards.forEach((pc, index) => {
      pc.resolutionOrder = index + 1;
    });

    for (const playedCard of sortedCards) {
      const card = cardRepo.getCard(playedCard.cardId);
      for (const effect of card.effects) {
        this.resolveEffect(effect, playedCard.owner, card.id);
      }
      playedCard.resolved = true;
    }

    this.cleanupExpiredEffects();
    this.movePlayedCardsToDiscard();

    return this.state;
  }

  private resolveEffect(
    effect: CardEffect,
    sourcePlayer: PlayerId,
    sourceCardId: string
  ): EffectResolutionResult {
    const targetPlayer = effect.target === 'self' ? sourcePlayer : this.getOpponent(sourcePlayer);

    let result: EffectResolutionResult = {
      state: this.state,
      applied: true,
      finalValue: effect.value,
      reflected: false,
      immunized: false,
    };

    switch (effect.effectType) {
      case 'deal_embarrassment':
        result = this.resolveDealEmbarrassment(effect, sourcePlayer, targetPlayer, sourceCardId);
        break;
      case 'reduce_embarrassment':
        result = this.resolveReduceEmbarrassment(effect, targetPlayer);
        break;
      case 'gain_immunity':
        result = this.resolveGainImmunity(effect, targetPlayer, sourceCardId);
        break;
      case 'gain_reflect':
        result = this.resolveGainReflect(effect, targetPlayer, sourceCardId);
        break;
      case 'multiply_damage':
        result = this.resolveMultiplyDamage(effect, targetPlayer, sourceCardId);
        break;
      case 'extra_turn_card':
      case 'draw_cards':
      case 'discard_enemy':
        result.applied = false;
        break;
      default:
        result.applied = false;
    }

    return result;
  }

  private resolveDealEmbarrassment(
    effect: CardEffect,
    sourcePlayer: PlayerId,
    targetPlayer: PlayerId,
    _sourceCardId: string
  ): EffectResolutionResult {
    let damage = effect.value;
    const target = this.state.players[targetPlayer];

    const multiplier = this.getDamageMultiplier(targetPlayer);
    damage = Math.floor(damage * multiplier);

    const immunityCheck = this.consumeImmunity(targetPlayer);
    if (immunityCheck) {
      this.addLog(
        sourcePlayer,
        `攻击被【${cardRepo.getCard(immunityCheck.sourceCardId).name}】免疫`,
        'defense'
      );
      return {
        state: this.state,
        applied: false,
        finalValue: 0,
        reflected: false,
        immunized: true,
      };
    }

    const reflectCheck = this.consumeReflect(targetPlayer);
    if (reflectCheck) {
      const reflectDamage = Math.floor(damage * reflectCheck.value);
      const source = this.state.players[sourcePlayer];

      const sourceImmunity = this.consumeImmunity(sourcePlayer);
      if (sourceImmunity) {
        this.addLog(
          targetPlayer,
          `反弹被【${cardRepo.getCard(sourceImmunity.sourceCardId).name}】免疫`,
          'defense'
        );
      } else {
        source.embarrassment = Math.min(
          cardRepo.getConfig().maxEmbarrassment,
          source.embarrassment + reflectDamage
        );
        this.addLog(
          targetPlayer,
          `反弹了 ${reflectDamage} 点尴尬值给对方`,
          'reflect' as any
        );
      }

      if (reflectCheck.value < 1) {
        const remainingDamage = damage - reflectDamage;
        target.embarrassment = Math.min(
          cardRepo.getConfig().maxEmbarrassment,
          target.embarrassment + remainingDamage
        );
        this.addLog(sourcePlayer, `造成 ${remainingDamage} 点尴尬值`, 'attack');
      }

      return {
        state: this.state,
        applied: true,
        finalValue: damage,
        reflected: true,
        immunized: false,
      };
    }

    target.embarrassment = Math.min(
      cardRepo.getConfig().maxEmbarrassment,
      target.embarrassment + damage
    );
    this.addLog(sourcePlayer, `造成 ${damage} 点尴尬值`, 'attack');

    this.checkGameOver();

    return {
      state: this.state,
      applied: true,
      finalValue: damage,
      reflected: false,
      immunized: false,
    };
  }

  private resolveReduceEmbarrassment(
    effect: CardEffect,
    targetPlayer: PlayerId
  ): EffectResolutionResult {
    const target = this.state.players[targetPlayer];
    target.embarrassment = Math.max(0, target.embarrassment - effect.value);
    this.addLog(targetPlayer, `减少了 ${effect.value} 点尴尬值`, 'defense');

    return {
      state: this.state,
      applied: true,
      finalValue: effect.value,
      reflected: false,
      immunized: false,
    };
  }

  private resolveGainImmunity(
    effect: CardEffect,
    targetPlayer: PlayerId,
    sourceCardId: string
  ): EffectResolutionResult {
    const target = this.state.players[targetPlayer];
    target.activeEffects.push({
      effectType: 'gain_immunity',
      value: effect.value,
      remainingDuration: effect.duration || 1,
      remainingUses: effect.value,
      sourceCardId,
    });
    this.addLog(targetPlayer, '获得了免疫效果', 'defense');

    return {
      state: this.state,
      applied: true,
      finalValue: effect.value,
      reflected: false,
      immunized: false,
    };
  }

  private resolveGainReflect(
    effect: CardEffect,
    targetPlayer: PlayerId,
    sourceCardId: string
  ): EffectResolutionResult {
    const target = this.state.players[targetPlayer];
    target.activeEffects.push({
      effectType: 'gain_reflect',
      value: effect.value,
      remainingDuration: effect.duration || 1,
      remainingUses: 1,
      sourceCardId,
    });
    this.addLog(targetPlayer, '获得了反弹效果', 'effect');

    return {
      state: this.state,
      applied: true,
      finalValue: effect.value,
      reflected: false,
      immunized: false,
    };
  }

  private resolveDrawCards(
    effect: CardEffect,
    targetPlayer: PlayerId
  ): EffectResolutionResult {
    const target = this.state.players[targetPlayer];
    const drawn = this.drawCards(target, effect.value);
    this.addLog(targetPlayer, `抽了 ${drawn} 张牌`, 'effect');

    return {
      state: this.state,
      applied: true,
      finalValue: drawn,
      reflected: false,
      immunized: false,
    };
  }

  private resolveDiscardEnemy(
    effect: CardEffect,
    targetPlayer: PlayerId
  ): EffectResolutionResult {
    const target = this.state.players[targetPlayer];
    const discarded = this.discardRandomCards(target, effect.value);
    this.addLog(targetPlayer, `弃掉了 ${discarded} 张牌`, 'effect');

    return {
      state: this.state,
      applied: true,
      finalValue: discarded,
      reflected: false,
      immunized: false,
    };
  }

  private resolveMultiplyDamage(
    effect: CardEffect,
    targetPlayer: PlayerId,
    sourceCardId: string
  ): EffectResolutionResult {
    const target = this.state.players[targetPlayer];
    target.activeEffects.push({
      effectType: 'multiply_damage',
      value: effect.value,
      remainingDuration: 1,
      remainingUses: effect.applyToNext || 1,
      sourceCardId,
    });
    this.addLog(
      targetPlayer,
      `下次攻击伤害变为 ${Math.round(effect.value * 100)}%`,
      'effect'
    );

    return {
      state: this.state,
      applied: true,
      finalValue: effect.value,
      reflected: false,
      immunized: false,
    };
  }

  private resolveExtraTurnCard(
    effect: CardEffect,
    targetPlayer: PlayerId
  ): EffectResolutionResult {
    const target = this.state.players[targetPlayer];
    target.extraCardsThisTurn += effect.value;
    this.addLog(targetPlayer, `本回合可多出 ${effect.value} 张牌`, 'effect');

    return {
      state: this.state,
      applied: true,
      finalValue: effect.value,
      reflected: false,
      immunized: false,
    };
  }

  private consumeImmunity(playerId: PlayerId): ActiveEffect | null {
    const player = this.state.players[playerId];
    const immunityIndex = player.activeEffects.findIndex(
      (e) => e.effectType === 'gain_immunity' && (e.remainingUses || 0) > 0
    );

    if (immunityIndex === -1) return null;

    const immunity = player.activeEffects[immunityIndex];
    immunity.remainingUses = (immunity.remainingUses || 1) - 1;

    if (immunity.remainingUses <= 0) {
      player.activeEffects.splice(immunityIndex, 1);
    }

    return immunity;
  }

  private consumeReflect(playerId: PlayerId): ActiveEffect | null {
    const player = this.state.players[playerId];
    const reflectIndex = player.activeEffects.findIndex(
      (e) => e.effectType === 'gain_reflect' && (e.remainingUses || 0) > 0
    );

    if (reflectIndex === -1) return null;

    const reflect = player.activeEffects[reflectIndex];
    reflect.remainingUses = (reflect.remainingUses || 1) - 1;

    if (reflect.remainingUses <= 0) {
      player.activeEffects.splice(reflectIndex, 1);
    }

    return reflect;
  }

  private getDamageMultiplier(playerId: PlayerId): number {
    const player = this.state.players[playerId];
    const multiplyEffects = player.activeEffects.filter(
      (e) => e.effectType === 'multiply_damage' && (e.remainingUses || 0) > 0
    );

    if (multiplyEffects.length === 0) return 1;

    multiplyEffects.sort((a, b) => a.value - b.value);
    const strongest = multiplyEffects[0];
    strongest.remainingUses = (strongest.remainingUses || 1) - 1;

    if (strongest.remainingUses <= 0) {
      const idx = player.activeEffects.indexOf(strongest);
      if (idx > -1) player.activeEffects.splice(idx, 1);
    }

    return strongest.value;
  }

  private cleanupExpiredEffects(): void {
    for (const playerId of ['player', 'enemy'] as PlayerId[]) {
      const player = this.state.players[playerId];
      player.activeEffects = player.activeEffects.filter((e) => {
        e.remainingDuration -= 1;
        return e.remainingDuration > 0;
      });
    }
  }

  private movePlayedCardsToDiscard(): void {
    for (const playedCard of this.state.playedCardsThisTurn) {
      const player = this.state.players[playedCard.owner];
      player.discardPile.push(playedCard.cardId);
    }
    this.state.playedCardsThisTurn = [];
  }

  drawCards(player: PlayerState, count: number): number {
    const config = cardRepo.getConfig();
    let drawn = 0;

    for (let i = 0; i < count; i++) {
      if (player.hand.length >= config.maxHandSize) break;

      if (player.deck.length === 0) {
        if (player.discardPile.length === 0) break;
        player.deck = cardRepo.shuffleDeck(player.discardPile);
        player.discardPile = [];
      }

      const card = player.deck.shift();
      if (card) {
        player.hand.push(card);
        drawn++;
      }
    }

    return drawn;
  }

  private discardRandomCards(player: PlayerState, count: number): number {
    let discarded = 0;
    for (let i = 0; i < count; i++) {
      if (player.hand.length === 0) break;
      const idx = Math.floor(Math.random() * player.hand.length);
      const card = player.hand.splice(idx, 1)[0];
      player.discardPile.push(card);
      discarded++;
    }
    return discarded;
  }

  startTurn(playerId: PlayerId): void {
    const player = this.state.players[playerId];
    const config = cardRepo.getConfig();

    player.cardsPlayedThisTurn = 0;
    player.extraCardsThisTurn = 0;

    this.drawCards(player, 1);

    this.state.currentTurn = playerId;
    this.state.phase = 'main_phase';
    this.state.turnTimeRemaining = config.turnTimeLimit;

    this.addLog(playerId, `回合 ${this.state.turnNumber} 开始`, 'system');
  }

  endTurn(): void {
    const currentPlayer = this.state.currentTurn;
    const opponent = this.getOpponent(currentPlayer);

    this.state.phase = 'resolving';
    this.resolveTurnEffects();

    if ((this.state.phase as string) === 'game_over') return;

    this.state.turnNumber += 1;
    this.state.currentTurn = opponent;
    this.state.phase = 'turn_end';

    this.startTurn(opponent);
  }

  private checkGameOver(): void {
    const config = cardRepo.getConfig();
    for (const playerId of ['player', 'enemy'] as PlayerId[]) {
      if (this.state.players[playerId].embarrassment >= config.maxEmbarrassment) {
        this.state.phase = 'game_over';
        this.state.winner = this.getOpponent(playerId);
        this.addLog(
          playerId,
          `尴尬值爆表！${this.state.winner === 'player' ? '你' : 'AI'}获胜！`,
          'system'
        );
        return;
      }
    }
  }

  private getOpponent(playerId: PlayerId): PlayerId {
    return playerId === 'player' ? 'enemy' : 'player';
  }

  private addLog(playerId: PlayerId, message: string, type: GameLogEntry['type']): void {
    this.state.log.push({
      turn: this.state.turnNumber,
      message: `${playerId === 'player' ? '你' : 'AI'}: ${message}`,
      type,
    });
  }
}
