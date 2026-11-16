export type TimelineDirection = 'upcoming' | 'past';

// The past section is last whenever it has rows, regardless of upcoming cursors.
export function timelineEndDirection(pastCount: number): TimelineDirection {
  return pastCount > 0 ? 'past' : 'upcoming';
}

// Deduplicate repeated viewport notifications, retaining the other section's demand.
export class TimelinePageQueue {
  private active: TimelineDirection | null = null;
  private pending = new Set<TimelineDirection>();

  request(direction: TimelineDirection) {
    if (this.active !== direction) this.pending.add(direction);
    return this.next();
  }

  complete() {
    this.active = null;
    return this.next();
  }

  clear() {
    this.pending.clear();
  }

  private next(): TimelineDirection | null {
    if (this.active) return null;
    const direction = this.pending.values().next().value;
    if (!direction) return null;
    this.pending.delete(direction);
    this.active = direction;
    return direction;
  }
}
