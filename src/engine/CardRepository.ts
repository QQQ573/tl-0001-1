import cardData from '../data/cards.json';
import type { CardData, CardDataBundle, GameConfig, DeckEntry } from '../types';

export class CardRepository {
  private cards: Map<string, CardData> = new Map();
  private config: GameConfig;
  private decks: Record<string, DeckEntry[]>;

  constructor() {
    const bundle = cardData as CardDataBundle;
    this.config = bundle.gameConfig;
    this.decks = bundle.decks;
    bundle.cards.forEach((card) => {
      this.cards.set(card.id, card);
    });
  }

  getCard(cardId: string): CardData {
    const card = this.cards.get(cardId);
    if (!card) {
      throw new Error(`Card not found: ${cardId}`);
    }
    return card;
  }

  getAllCards(): CardData[] {
    return Array.from(this.cards.values());
  }

  getConfig(): GameConfig {
    return { ...this.config };
  }

  getDeck(deckName: string = 'standard'): string[] {
    const deckEntries = this.decks[deckName];
    if (!deckEntries) {
      throw new Error(`Deck not found: ${deckName}`);
    }
    const deck: string[] = [];
    deckEntries.forEach((entry) => {
      for (let i = 0; i < entry.count; i++) {
        deck.push(entry.cardId);
      }
    });
    return deck;
  }

  shuffleDeck(deck: string[]): string[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}

export const cardRepo = new CardRepository();
