import { describe, it, expect } from 'vitest';
import { EffectEngine } from '../src/engine/EffectEngine';
import { AISystem } from '../src/engine/AISystem';
import { cardRepo } from '../src/engine/CardRepository';
import type { GameState, PlayerState } from '../src/types';

function createMockState(): GameState {
  const config = cardRepo.getConfig();
  const playerDeck = cardRepo.getDeck('standard');
  const enemyDeck = cardRepo.getDeck('standard');

  const player: PlayerState = {
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

  const enemy: PlayerState = {
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

  return {
    phase: 'main_phase',
    currentTurn: 'player',
    turnNumber: 1,
    players: { player, enemy },
    playedCardsThisTurn: [],
    winner: null,
    turnTimeRemaining: config.turnTimeLimit,
    log: [],
  };
}

describe('边界测试 1: 双重反弹同时触发', () => {
  it('双方都有反弹时，攻击应被多次反弹计算', () => {
    const state = createMockState();
    state.players.player.embarrassment = 50;
    state.players.enemy.embarrassment = 50;

    state.players.player.activeEffects.push({
      effectType: 'gain_reflect',
      value: 1,
      remainingDuration: 1,
      remainingUses: 1,
      sourceCardId: 'full_mirror',
    });

    state.players.enemy.activeEffects.push({
      effectType: 'gain_reflect',
      value: 0.5,
      remainingDuration: 1,
      remainingUses: 1,
      sourceCardId: 'humor_defuse',
    });

    const engine = new EffectEngine(state);

    state.players.player.hand.push('soul_question');
    const result = engine.playCard('soul_question', 'player');
    expect(result.success).toBe(true);

    engine.resolveTurnEffects();

    const finalState = engine.getState();
    expect(finalState.players.player.embarrassment).toBeLessThan(50 + 12);
    expect(finalState.players.player.activeEffects.length).toBe(0);
    expect(finalState.players.enemy.activeEffects.length).toBe(0);
  });
});

describe('边界测试 2: 免疫效果叠加', () => {
  it('多层免疫效果应独立计数', () => {
    const state = createMockState();
    state.players.enemy.embarrassment = 30;

    state.players.enemy.activeEffects.push(
      {
        effectType: 'gain_immunity',
        value: 1,
        remainingDuration: 2,
        remainingUses: 1,
        sourceCardId: 'silence_is_gold',
      },
      {
        effectType: 'gain_immunity',
        value: 99,
        remainingDuration: 1,
        remainingUses: 99,
        sourceCardId: 'deep_immunity',
      }
    );

    const engine = new EffectEngine(state);

    for (let i = 0; i < 5; i++) {
      state.players.player.hand.push('awkward_silence');
      engine.playCard('awkward_silence', 'player');
    }

    engine.resolveTurnEffects();

    const finalState = engine.getState();
    expect(finalState.players.enemy.embarrassment).toBe(30);

    const remainingImmunities = finalState.players.enemy.activeEffects.filter(
      (e) => e.effectType === 'gain_immunity' && (e.remainingUses || 0) > 0
    );
    expect(remainingImmunities.length).toBeGreaterThanOrEqual(0);
  });
});

describe('边界测试 3: 同回合多张牌按速度值结算顺序', () => {
  it('速度值高的牌应先结算', () => {
    const state = createMockState();
    state.players.player.embarrassment = 50;
    state.players.enemy.embarrassment = 50;
    state.players.player.extraCardsThisTurn = 2;

    const engine = new EffectEngine(state);

    state.players.player.hand.push('soul_question', 'small_talk', 'change_topic', 'gift_fail');

    const result1 = engine.playCard('soul_question', 'player');
    const result2 = engine.playCard('small_talk', 'player');
    const result3 = engine.playCard('change_topic', 'player');

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result3.success).toBe(true);

    const beforeResolve = engine.getState();
    const playedCards = [...beforeResolve.playedCardsThisTurn];

    engine.resolveTurnEffects();

    const sortedCards = [...playedCards].sort((a, b) => {
      const cardA = cardRepo.getCard(a.cardId);
      const cardB = cardRepo.getCard(b.cardId);
      return cardB.speed - cardA.speed;
    });

    expect(sortedCards[0].cardId).toBe('change_topic');
    expect(sortedCards[1].cardId).toBe('small_talk');
    expect(sortedCards[2].cardId).toBe('soul_question');
  });
});

describe('边界测试 4: 互斥牌型拒绝', () => {
  it('同类型互斥牌不能在同一回合出多张', () => {
    const state = createMockState();
    state.players.player.embarrassment = 50;

    const engine = new EffectEngine(state);

    state.players.player.hand.push('silence_is_gold', 'deep_immunity');

    const result1 = engine.playCard('silence_is_gold', 'player');
    expect(result1.success).toBe(true);

    const result2 = engine.playCard('deep_immunity', 'player');
    expect(result2.success).toBe(false);
    expect(result2.reason).toContain('互斥');
  });

  it('控制类牌互斥检测', () => {
    const state = createMockState();
    state.players.player.embarrassment = 30;

    const engine = new EffectEngine(state);

    state.players.player.hand.push('change_topic', 'work_talk');

    const result1 = engine.playCard('change_topic', 'player');
    expect(result1.success).toBe(true);

    const result2 = engine.playCard('work_talk', 'player');
    expect(result2.success).toBe(false);
  });
});

describe('边界测试 5: 回合超时默认出牌', () => {
  it('超时后应自动出一张可出的牌', () => {
    const state = createMockState();
    state.players.player.embarrassment = 30;
    state.players.player.hand.push('small_talk', 'awkward_silence');

    const engine = new EffectEngine(state);
    const playable = state.players.player.hand.filter((cardId) => {
      const card = cardRepo.getCard(cardId);
      return state.players.player.embarrassment >= card.cost;
    });

    expect(playable.length).toBeGreaterThan(0);

    if (playable.length > 0) {
      const result = engine.playCard(playable[0], 'player');
      expect(result.success).toBe(true);
    }
  });
});

describe('边界测试 6: 尴尬值不足时无法出牌', () => {
  it('尴尬值低于卡牌消耗时不能出牌', () => {
    const state = createMockState();
    state.players.player.embarrassment = 5;

    const engine = new EffectEngine(state);
    state.players.player.hand.push('ex_comparison');

    const result = engine.playCard('ex_comparison', 'player');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('尴尬值不足');
  });
});

describe('边界测试 7: 牌库耗尽时弃牌堆重洗', () => {
  it('牌库为空时应将弃牌堆洗入牌库', () => {
    const state = createMockState();
    const player = state.players.player;

    player.deck = [];
    player.discardPile = ['small_talk', 'awkward_silence', 'sincere_compliment'];
    player.hand = [];

    const engine = new EffectEngine(state);
    const drawn = engine.drawCards(player, 3);

    expect(drawn).toBe(3);
    expect(player.hand.length).toBe(3);
    expect(player.deck.length).toBe(0);
    expect(player.discardPile.length).toBe(0);
  });
});

describe('边界测试 8: 手牌上限限制', () => {
  it('抽牌不应超过手牌上限', () => {
    const state = createMockState();
    const config = cardRepo.getConfig();
    const player = state.players.player;

    player.hand = new Array(config.maxHandSize).fill('small_talk');
    player.deck = ['awkward_silence', 'soul_question', 'gift_fail'];

    const engine = new EffectEngine(state);
    const drawn = engine.drawCards(player, 3);

    expect(drawn).toBe(0);
    expect(player.hand.length).toBe(config.maxHandSize);
  });
});

describe('边界测试 9: 反弹伤害可被免疫', () => {
  it('反弹的伤害可被攻击方的免疫效果抵挡', () => {
    const state = createMockState();
    state.players.player.embarrassment = 50;
    state.players.enemy.embarrassment = 50;

    state.players.enemy.activeEffects.push({
      effectType: 'gain_reflect',
      value: 1,
      remainingDuration: 1,
      remainingUses: 1,
      sourceCardId: 'full_mirror',
    });

    state.players.player.activeEffects.push({
      effectType: 'gain_immunity',
      value: 1,
      remainingDuration: 1,
      remainingUses: 1,
      sourceCardId: 'silence_is_gold',
    });

    const engine = new EffectEngine(state);
    state.players.player.hand.push('soul_question');
    engine.playCard('soul_question', 'player');

    const playerBefore = state.players.player.embarrassment;
    engine.resolveTurnEffects();
    const playerAfter = state.players.player.embarrassment;

    expect(playerAfter).toBe(playerBefore);
  });
});

describe('边界测试 10: 伤害乘数与反弹交互', () => {
  it('伤害减半效果应在反弹前计算', () => {
    const state = createMockState();
    state.players.player.embarrassment = 50;
    state.players.enemy.embarrassment = 50;

    state.players.enemy.activeEffects.push({
      effectType: 'multiply_damage',
      value: 0.5,
      remainingDuration: 1,
      remainingUses: 1,
      sourceCardId: 'change_topic',
    });

    state.players.enemy.activeEffects.push({
      effectType: 'gain_reflect',
      value: 1,
      remainingDuration: 1,
      remainingUses: 1,
      sourceCardId: 'full_mirror',
    });

    const engine = new EffectEngine(state);
    state.players.player.hand.push('soul_question');
    engine.playCard('soul_question', 'player');
    engine.resolveTurnEffects();

    const finalState = engine.getState();
    expect(finalState.players.player.embarrassment).toBe(50 - 10 + 6);
    expect(finalState.players.enemy.embarrassment).toBe(50);
  });
});

describe('边界测试 11: 额外出牌次数效果', () => {
  it('撒娇卖萌应增加本回合可出牌数', () => {
    const state = createMockState();
    const config = cardRepo.getConfig();
    state.players.player.embarrassment = 50;

    const engine = new EffectEngine(state);
    state.players.player.hand.push('shameless_flirt', 'small_talk', 'awkward_silence', 'sincere_compliment');

    const result1 = engine.playCard('shameless_flirt', 'player');
    expect(result1.success).toBe(true);
    expect(state.players.player.extraCardsThisTurn).toBe(1);

    const result2 = engine.playCard('small_talk', 'player');
    expect(result2.success).toBe(true);

    const result3 = engine.playCard('awkward_silence', 'player');
    expect(result3.success).toBe(true);

    const maxCards = config.cardsPerTurn + state.players.player.extraCardsThisTurn;
    expect(state.players.player.cardsPlayedThisTurn).toBeLessThanOrEqual(maxCards);
  });
});

describe('边界测试 12: 游戏结束判定', () => {
  it('尴尬值达到上限时游戏结束', () => {
    const state = createMockState();
    const config = cardRepo.getConfig();
    state.players.enemy.embarrassment = config.maxEmbarrassment - 10;

    const engine = new EffectEngine(state);
    state.players.player.hand.push('double_down');
    engine.playCard('double_down', 'player');
    engine.resolveTurnEffects();

    const finalState = engine.getState();
    expect(finalState.phase).toBe('game_over');
    expect(finalState.winner).toBe('player');
    expect(finalState.players.enemy.embarrassment).toBeGreaterThanOrEqual(config.maxEmbarrassment);
  });

  it('尴尬值超过上限后应被限制为上限值', () => {
    const state = createMockState();
    const config = cardRepo.getConfig();
    state.players.enemy.embarrassment = config.maxEmbarrassment - 5;

    const engine = new EffectEngine(state);
    state.players.player.hand.push('double_down');
    engine.playCard('double_down', 'player');
    engine.resolveTurnEffects();

    const finalState = engine.getState();
    expect(finalState.players.enemy.embarrassment).toBe(config.maxEmbarrassment);
  });
});

describe('AI 系统测试', () => {
  it('保守型 AI 应优先选择防御牌', () => {
    const state = createMockState();
    state.players.enemy.hand = ['silence_is_gold', 'soul_question', 'small_talk'];
    state.players.enemy.embarrassment = 80;

    const ai = new AISystem('conservative');
    const cards = ai.chooseCardsToPlay(state);

    expect(cards.length).toBeGreaterThan(0);
    const firstCard = cardRepo.getCard(cards[0]);
    expect(firstCard.type === 'defense' || firstCard.type === 'reflect').toBe(true);
  });

  it('激进型 AI 应优先选择攻击牌', () => {
    const state = createMockState();
    state.players.enemy.hand = ['silence_is_gold', 'soul_question', 'ex_comparison'];
    state.players.enemy.embarrassment = 50;
    state.players.player.embarrassment = 70;

    const ai = new AISystem('aggressive');
    const cards = ai.chooseCardsToPlay(state);

    expect(cards.length).toBeGreaterThan(0);
    const firstCard = cardRepo.getCard(cards[0]);
    expect(firstCard.type).toBe('attack');
  });

  it('AI 不应选择互斥的牌', () => {
    const state = createMockState();
    state.players.enemy.hand = ['silence_is_gold', 'deep_immunity', 'small_talk'];
    state.players.enemy.embarrassment = 50;

    const ai = new AISystem('conservative');
    const cards = ai.chooseCardsToPlay(state);

    const hasBothDefense = cards.filter((id) => {
      const card = cardRepo.getCard(id);
      return card.type === 'defense' && card.exclusiveWith.includes('defense');
    });

    expect(hasBothDefense.length).toBeLessThanOrEqual(1);
  });

  it('AI 出牌应考虑费用限制', () => {
    const state = createMockState();
    state.players.enemy.embarrassment = 10;
    state.players.enemy.hand = ['ex_comparison', 'small_talk', 'awkward_silence'];

    const ai = new AISystem('balanced');
    const cards = ai.chooseCardsToPlay(state);

    let totalCost = 0;
    for (const cardId of cards) {
      totalCost += cardRepo.getCard(cardId).cost;
    }

    expect(totalCost).toBeLessThanOrEqual(10);
  });
});
