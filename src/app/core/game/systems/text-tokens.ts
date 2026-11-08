import { BehaviorMetrics } from '../models';
import { mostVisitedRoom } from './behavior/behavior-profile';

export interface TokenContext {
  readonly employee: string;
  readonly metrics: BehaviorMetrics;
  readonly clock: string;
  readonly previousRoomId: string | null;
  roomName(roomId: string): string;
  behaviorMessage(): string;
}

/**
 * Resolves {tokens} in in-world text so the building can reference the player's behaviour.
 * Unknown tokens are left untouched (and are caught by tests/validation).
 */
export function resolveTokens(text: string, ctx: TokenContext, depth = 0): string {
  if (depth > 2 || !text.includes('{')) return text;
  const resolved = text.replace(/\{([a-zA-Z]+)(?::([a-z0-9-]+))?\}/g, (match, token: string, arg?: string) => {
    switch (token) {
      case 'employee':
        return ctx.employee;
      case 'doorCount':
        return String(ctx.metrics.doorInteractions);
      case 'inspections':
        return String(ctx.metrics.inspections);
      case 'mostVisitedRoom': {
        const best = mostVisitedRoom(ctx.metrics);
        return best ? ctx.roomName(best.roomId).toUpperCase() : 'RECEPTION';
      }
      case 'mostVisitedCount': {
        const best = mostVisitedRoom(ctx.metrics);
        return String(best?.count ?? 1);
      }
      case 'lastRoom':
        return ctx.previousRoomId ? ctx.roomName(ctx.previousRoomId).toUpperCase() : 'RECEPTION';
      case 'time':
        return ctx.clock;
      case 'firstVisit':
        return (arg && ctx.metrics.firstRoomEntryClock[arg]) || '09:00';
      case 'behaviorMessage':
        return resolveTokens(ctx.behaviorMessage(), ctx, depth + 1);
      default:
        return match;
    }
  });
  return resolved;
}

/** Shift clock: 09:00 + elapsed fraction of an 8 hour shift. */
export function shiftClock(elapsedSec: number, shiftDurationMin: number): { minutes: number; label: string; overtime: boolean } {
  const fraction = elapsedSec / Math.max(1, shiftDurationMin * 60);
  const minutes = 9 * 60 + fraction * 8 * 60;
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return {
    minutes,
    label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    overtime: minutes >= 17 * 60,
  };
}
