import { GameEngine } from './engine/GameEngine';
import type { GameState, AIStyle, CardData } from './types';
import { cardRepo } from './engine/CardRepository';

class GameUI {
  private gameEngine: GameEngine | null = null;
  private selectedDifficulty: AIStyle = 'balanced';

  private startScreen: HTMLElement;
  private gameScreen: HTMLElement;
  private gameOverScreen: HTMLElement;

  private playerHandEl: HTMLElement;
  private battleLogEl: HTMLElement;
  private cardTooltip: HTMLElement;

  constructor() {
    this.startScreen = document.getElementById('start-screen')!;
    this.gameScreen = document.getElementById('game-screen')!;
    this.gameOverScreen = document.getElementById('game-over-screen')!;
    this.playerHandEl = document.getElementById('player-hand')!;
    this.battleLogEl = document.getElementById('battle-log')!;
    this.cardTooltip = document.getElementById('card-tooltip')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        this.selectedDifficulty = target.dataset.style as AIStyle;
        this.updateDifficultySelection();
      });
    });

    document.getElementById('start-btn')!.addEventListener('click', () => {
      this.startGame();
    });

    document.getElementById('end-turn-btn')!.addEventListener('click', () => {
      if (this.gameEngine) {
        this.gameEngine.endTurn('player');
      }
    });

    document.getElementById('restart-btn')!.addEventListener('click', () => {
      this.showStartScreen();
    });
  }

  private updateDifficultySelection(): void {
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      const btnEl = btn as HTMLElement;
      if (btnEl.dataset.style === this.selectedDifficulty) {
        btnEl.classList.add('selected');
      } else {
        btnEl.classList.remove('selected');
      }
    });
  }

  private startGame(): void {
    if (this.gameEngine) {
      this.gameEngine.destroy();
    }

    this.gameEngine = new GameEngine(this.selectedDifficulty);
    this.gameEngine.setStateChangeListener((state) => {
      this.render(state);
    });

    this.gameEngine.startGame();
    this.showGameScreen();
  }

  private showStartScreen(): void {
    this.startScreen.classList.add('active');
    this.gameScreen.classList.remove('active');
    this.gameOverScreen.classList.remove('active');
  }

  private showGameScreen(): void {
    this.startScreen.classList.remove('active');
    this.gameScreen.classList.add('active');
    this.gameOverScreen.classList.remove('active');
  }

  private showGameOverScreen(state: GameState): void {
    this.gameOverScreen.classList.add('active');
    this.startScreen.classList.remove('active');
    this.gameScreen.classList.remove('active');

    const isWin = state.winner === 'player';
    const iconEl = document.getElementById('game-over-icon')!;
    const titleEl = document.getElementById('game-over-title')!;
    const msgEl = document.getElementById('game-over-message')!;
    const playerEmbEl = document.getElementById('final-player-emb')!;
    const turnsEl = document.getElementById('final-turns')!;

    iconEl.textContent = isWin ? '🎉' : '😅';
    titleEl.textContent = isWin ? '恭喜获胜！' : '尴尬爆表！';
    msgEl.textContent = isWin
      ? '你成功让对方尴尬到想找地缝钻！'
      : '你尴尬得想逃离这场晚餐...';
    playerEmbEl.textContent = state.players.player.embarrassment.toString();
    turnsEl.textContent = state.turnNumber.toString();
  }

  private render(state: GameState): void {
    if (state.phase === 'game_over') {
      this.showGameOverScreen(state);
      return;
    }

    this.renderTurnInfo(state);
    this.renderPlayerStats(state);
    this.renderEnemyStats(state);
    this.renderHand(state);
    this.renderBattleLog(state);
    this.renderActiveEffects(state);
    this.renderEndTurnButton(state);
  }

  private renderTurnInfo(state: GameState): void {
    const turnNumberEl = document.getElementById('turn-number')!;
    const currentTurnEl = document.getElementById('current-turn')!;
    const timerEl = document.getElementById('timer')!;

    turnNumberEl.textContent = `回合 ${state.turnNumber}`;
    currentTurnEl.textContent = state.currentTurn === 'player' ? '你的回合' : 'AI 回合';

    if (state.currentTurn === 'player') {
      currentTurnEl.classList.remove('enemy-turn');
    } else {
      currentTurnEl.classList.add('enemy-turn');
    }

    timerEl.textContent = state.turnTimeRemaining.toString();
    if (state.turnTimeRemaining <= 5 && state.currentTurn === 'player') {
      timerEl.classList.add('timer-warning');
    } else {
      timerEl.classList.remove('timer-warning');
    }
  }

  private renderPlayerStats(state: GameState): void {
    const config = cardRepo.getConfig();
    const player = state.players.player;

    const fillEl = document.getElementById('player-embarrassment-fill')!;
    const textEl = document.getElementById('player-embarrassment-text')!;
    const playedEl = document.getElementById('cards-played-count')!;
    const maxEl = document.getElementById('max-cards-per-turn')!;

    const percentage = (player.embarrassment / config.maxEmbarrassment) * 100;
    fillEl.style.width = `${percentage}%`;
    textEl.textContent = `${player.embarrassment}/${config.maxEmbarrassment}`;

    const maxCards = config.cardsPerTurn + player.extraCardsThisTurn;
    playedEl.textContent = player.cardsPlayedThisTurn.toString();
    maxEl.textContent = maxCards.toString();
  }

  private renderEnemyStats(state: GameState): void {
    const config = cardRepo.getConfig();
    const enemy = state.players.enemy;

    const fillEl = document.getElementById('enemy-embarrassment-fill')!;
    const textEl = document.getElementById('enemy-embarrassment-text')!;
    const handCountEl = document.getElementById('enemy-hand-count')!;

    const percentage = (enemy.embarrassment / config.maxEmbarrassment) * 100;
    fillEl.style.width = `${percentage}%`;
    textEl.textContent = `${enemy.embarrassment}/${config.maxEmbarrassment}`;
    handCountEl.textContent = enemy.hand.length.toString();
  }

  private renderHand(state: GameState): void {
    const player = state.players.player;
    const playableCards = this.gameEngine?.getPlayableCards('player') || [];
    const isPlayerTurn = state.currentTurn === 'player' && state.phase === 'main_phase';

    this.playerHandEl.innerHTML = '';

    player.hand.forEach((cardId) => {
      const card = cardRepo.getCard(cardId);
      const isPlayable = isPlayerTurn && playableCards.includes(cardId);
      const cardEl = this.createCardElement(card, isPlayable);
      this.playerHandEl.appendChild(cardEl);
    });
  }

  private createCardElement(card: CardData, playable: boolean): HTMLElement {
    const cardEl = document.createElement('div');
    cardEl.className = `card ${card.type}`;
    if (!playable) {
      cardEl.classList.add('disabled');
    }

    const typeIcons: Record<string, string> = {
      attack: '💥',
      defense: '🛡️',
      reflect: '🔄',
      control: '🎯',
      special: '✨',
    };

    const typeNames: Record<string, string> = {
      attack: '攻击',
      defense: '防御',
      reflect: '反弹',
      control: '控制',
      special: '特殊',
    };

    cardEl.innerHTML = `
      <div class="card-header">
        <div class="card-name">${card.name}</div>
        <div class="card-cost">${card.cost}</div>
      </div>
      <div class="card-type-icon">${typeIcons[card.type] || '🃏'}</div>
      <div class="card-desc">${card.description}</div>
      <div class="card-footer">
        <span class="card-type ${card.type}">${typeNames[card.type]}</span>
        <span class="card-speed">⚡${card.speed}</span>
      </div>
    `;

    if (playable) {
      cardEl.addEventListener('click', () => {
        if (this.gameEngine) {
          const result = this.gameEngine.playCard(card.id, 'player');
          if (!result.success && result.reason) {
            this.showToast(result.reason);
          }
        }
      });
    }

    cardEl.addEventListener('mouseenter', (e) => {
      this.showTooltip(card, e);
    });

    cardEl.addEventListener('mouseleave', () => {
      this.hideTooltip();
    });

    cardEl.addEventListener('mousemove', (e) => {
      this.moveTooltip(e);
    });

    return cardEl;
  }

  private renderBattleLog(state: GameState): void {
    const recentLogs = state.log.slice(-20);
    const existingEntries = this.battleLogEl.children.length;

    if (recentLogs.length === existingEntries) return;

    this.battleLogEl.innerHTML = '';
    recentLogs.forEach((entry) => {
      const div = document.createElement('div');
      div.className = `log-entry ${entry.type}`;
      div.textContent = entry.message;
      this.battleLogEl.appendChild(div);
    });

    this.battleLogEl.scrollTop = this.battleLogEl.scrollHeight;
  }

  private renderActiveEffects(state: GameState): void {
    const playerEffectsEl = document.getElementById('player-effects')!;
    const enemyEffectsEl = document.getElementById('enemy-effects')!;

    this.renderEffectsBadges(state.players.player.activeEffects, playerEffectsEl);
    this.renderEffectsBadges(state.players.enemy.activeEffects, enemyEffectsEl);
  }

  private renderEffectsBadges(effects: GameState['players']['player']['activeEffects'], container: HTMLElement): void {
    container.innerHTML = '';

    const effectNames: Record<string, { name: string; className: string }> = {
      gain_immunity: { name: '免疫', className: 'immunity' },
      gain_reflect: { name: '反弹', className: 'reflect' },
      multiply_damage: { name: '易伤', className: '' },
    };

    effects.forEach((effect) => {
      const info = effectNames[effect.effectType];
      if (!info) return;

      const badge = document.createElement('span');
      badge.className = `effect-badge ${info.className}`;

      let text = info.name;
      if (effect.remainingUses && effect.remainingUses > 1) {
        text += ` x${effect.remainingUses}`;
      }
      badge.textContent = text;
      container.appendChild(badge);
    });
  }

  private renderEndTurnButton(state: GameState): void {
    const btn = document.getElementById('end-turn-btn') as HTMLButtonElement;
    btn.disabled = state.currentTurn !== 'player' || state.phase !== 'main_phase';
  }

  private showTooltip(card: CardData, e: MouseEvent): void {
    const tooltip = this.cardTooltip;
    const typeNames: Record<string, string> = {
      attack: '攻击',
      defense: '防御',
      reflect: '反弹',
      control: '控制',
      special: '特殊',
    };

    tooltip.querySelector('.tooltip-name')!.textContent = card.name;
    const typeEl = tooltip.querySelector('.tooltip-type')!;
    typeEl.textContent = typeNames[card.type];
    typeEl.className = `tooltip-type card-type ${card.type}`;
    tooltip.querySelector('.tooltip-cost span')!.textContent = card.cost.toString();
    tooltip.querySelector('.tooltip-desc')!.textContent = card.description;

    tooltip.classList.remove('hidden');
    this.moveTooltip(e);
  }

  private moveTooltip(e: MouseEvent): void {
    const tooltip = this.cardTooltip;
    const x = e.clientX + 15;
    const y = e.clientY + 15;

    const rect = tooltip.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 10;
    const maxY = window.innerHeight - rect.height - 10;

    tooltip.style.left = `${Math.min(x, maxX)}px`;
    tooltip.style.top = `${Math.min(y, maxY)}px`;
  }

  private hideTooltip(): void {
    this.cardTooltip.classList.add('hidden');
  }

  private showToast(message: string): void {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(233, 69, 96, 0.9);
      color: white;
      padding: 12px 24px;
      border-radius: 25px;
      font-size: 0.9rem;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GameUI();
});
