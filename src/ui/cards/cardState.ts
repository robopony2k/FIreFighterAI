export type CardId = string;

export type CardVisualState = "collapsed" | "peek" | "expanded";

export type CardSnapshot = {
  id: CardId;
  visual: CardVisualState;
  pinned: boolean;
  focused: boolean;
};

type CardRecord = {
  visual: CardVisualState;
  pinned: boolean;
  focused: boolean;
};

export class CardStateModel {
  private cards = new Map<CardId, CardRecord>();

  private ensure(id: CardId): CardRecord {
    const existing = this.cards.get(id);
    if (existing) {
      return existing;
    }
    const created: CardRecord = {
      visual: "collapsed",
      pinned: false,
      focused: false
    };
    this.cards.set(id, created);
    return created;
  }

  private collapseIfUnpinned(id: CardId): void {
    const card = this.ensure(id);
    if (!card.pinned) {
      card.visual = "collapsed";
      card.focused = false;
    }
  }

  private blurOthers(id: CardId): void {
    this.cards.forEach((card, key) => {
      if (key !== id) {
        card.focused = false;
      }
    });
  }

  public register(id: CardId): void {
    this.ensure(id);
  }

  public remove(id: CardId): void {
    this.cards.delete(id);
  }

  public hoverEnter(id: CardId): void {
    const card = this.ensure(id);
    if (card.visual === "collapsed") {
      card.visual = "peek";
    }
  }

  public hoverLeave(id: CardId): void {
    const card = this.ensure(id);
    if (card.visual === "peek" && !card.pinned) {
      card.visual = "collapsed";
    }
  }

  public clickExpand(id: CardId): void {
    const card = this.ensure(id);
    card.visual = "expanded";
    card.focused = true;
    this.blurOthers(id);
  }

  public collapse(id: CardId): void {
    const card = this.ensure(id);
    card.visual = "collapsed";
    card.focused = false;
  }

  public togglePin(id: CardId): boolean {
    const card = this.ensure(id);
    card.pinned = !card.pinned;
    if (card.pinned) {
      card.visual = "expanded";
      card.focused = true;
      this.blurOthers(id);
    } else {
      this.collapseIfUnpinned(id);
    }
    return card.pinned;
  }

  public setPinned(id: CardId, pinned: boolean): void {
    const card = this.ensure(id);
    card.pinned = pinned;
    if (pinned) {
      card.visual = "expanded";
    } else if (card.visual === "expanded") {
      card.visual = "collapsed";
    }
  }

  public setFocused(id: CardId | null): void {
    if (id === null) {
      this.cards.forEach((card) => {
        card.focused = false;
      });
      return;
    }
    const card = this.ensure(id);
    card.focused = true;
    this.blurOthers(id);
  }

  public dismissNonPinned(): void {
    this.cards.forEach((card) => {
      if (!card.pinned) {
        card.visual = "collapsed";
        card.focused = false;
      }
    });
  }

  public dismiss(id: CardId): void {
    this.collapseIfUnpinned(id);
  }

  public get(id: CardId): CardSnapshot {
    const card = this.ensure(id);
    return {
      id,
      visual: card.visual,
      pinned: card.pinned,
      focused: card.focused
    };
  }

  public snapshots(): CardSnapshot[] {
    const out: CardSnapshot[] = [];
    this.cards.forEach((card, id) => {
      out.push({
        id,
        visual: card.visual,
        pinned: card.pinned,
        focused: card.focused
      });
    });
    return out;
  }
}

