import { Injectable } from '@angular/core';
import {
  BehaviorMetrics,
  BehaviorSnapshot,
  GameEvent,
  MovementSample,
  RoomId,
} from '../models';
import {
  NormalizationContext,
  computeProfile,
  createEmptyMetrics,
  mostVisitedRoom,
  normalizeMetrics,
  sanitizeMetrics,
} from './behavior/behavior-profile';

/** A->B->A with less than this many seconds spent in B counts as backtracking. */
const BACKTRACK_WINDOW_SEC = 25;
const MOVING_SPEED = 0.25;

/**
 * Records meaningful player events and aggregates per-frame movement samples into a
 * behaviour profile. Independent of Babylon.js - the engine only feeds it events/samples.
 */
@Injectable({ providedIn: 'root' })
export class BehaviorTrackingService {
  private metrics: BehaviorMetrics = createEmptyMetrics();
  private context: NormalizationContext = { totalInteractables: 1 };
  private currentRoom: RoomId | null = null;
  private entries: { roomId: RoomId; at: number }[] = [];
  private cached: { at: number; snapshot: BehaviorSnapshot } | null = null;

  /** Start a fresh session (New Game / Restart). */
  reset(context: NormalizationContext): void {
    this.metrics = createEmptyMetrics();
    this.context = context;
    this.currentRoom = null;
    this.entries = [];
    this.cached = null;
  }

  /** Resume a saved session. */
  restore(metrics: BehaviorMetrics, context: NormalizationContext): void {
    this.metrics = sanitizeMetrics(metrics);
    this.context = context;
    this.currentRoom = null;
    this.entries = [];
    this.cached = null;
  }

  getMetrics(): BehaviorMetrics {
    return this.metrics;
  }

  /** Deep copy for persistence. */
  exportMetrics(): BehaviorMetrics {
    return JSON.parse(JSON.stringify(this.metrics)) as BehaviorMetrics;
  }

  /** Aggregate a frame of movement. Nothing per-frame is stored, only accumulated. */
  sample(s: MovementSample): void {
    const m = this.metrics;
    m.totalTime += s.dt;
    if (s.speed > MOVING_SPEED) {
      m.moveTime += s.dt;
      if (s.sprinting) m.sprintTime += s.dt;
      else m.slowMoveTime += s.dt;
    } else {
      m.stillTime += s.dt;
    }
    if (!s.sprinting) m.lookAroundDegrees += Math.min(Math.abs(s.yawDeltaDeg), 45);
    if (s.inDarkArea) m.darkTime += s.dt;
    if (s.flashlightOn) m.flashlightTime += s.dt;
    if (s.roomId) m.roomTime[s.roomId] = (m.roomTime[s.roomId] ?? 0) + s.dt;
  }

  record(event: GameEvent, now: number, clock: string): void {
    const m = this.metrics;
    switch (event.type) {
      case 'room-enter': {
        m.roomEntries++;
        const visits = (m.roomVisits[event.roomId] ?? 0) + 1;
        m.roomVisits[event.roomId] = visits;
        if (visits > 1) m.roomRevisits++;
        else m.firstRoomEntryClock[event.roomId] = clock;
        const prev = this.entries[this.entries.length - 1];
        const prevPrev = this.entries[this.entries.length - 2];
        if (prev && prevPrev && prevPrev.roomId === event.roomId && now - prev.at <= BACKTRACK_WINDOW_SEC) {
          m.backtracks++;
        }
        this.entries.push({ roomId: event.roomId, at: now });
        if (this.entries.length > 8) this.entries.shift();
        this.currentRoom = event.roomId;
        break;
      }
      case 'room-exit':
        if (this.currentRoom === event.roomId) this.currentRoom = null;
        break;
      case 'door-interact':
        if (event.result === 'locked-attempt') m.lockedDoorAttempts++;
        else m.doorInteractions++;
        break;
      case 'object-inspect':
        m.inspections++;
        if (!m.inspectedProps.includes(event.propId)) {
          m.inspectedProps.push(event.propId);
          m.uniqueInspections++;
        }
        break;
      case 'object-gaze':
        m.gazes++;
        m.objectGazes[event.propId] = (m.objectGazes[event.propId] ?? 0) + 1;
        break;
      case 'interaction':
        m.interactions++;
        break;
      case 'flashlight':
        m.flashlightToggles++;
        break;
      case 'sprint':
        if (event.active) m.sprintStarts++;
        break;
      case 'report-confirmed':
        m.correctReports++;
        break;
      case 'report-rejected':
        m.falseReports++;
        break;
      case 'anomaly-witnessed':
        m.anomaliesWitnessed++;
        break;
      default:
        break;
    }
    this.cached = null;
  }

  /** Profile snapshot. Cached for a second of play time to keep the director tick cheap. */
  snapshot(): BehaviorSnapshot {
    const now = this.metrics.totalTime;
    if (this.cached && now - this.cached.at < 1) return this.cached.snapshot;
    const normalized = normalizeMetrics(this.metrics, this.context);
    const snapshot: BehaviorSnapshot = {
      metrics: this.metrics,
      normalized,
      profile: computeProfile(normalized, this.metrics),
    };
    this.cached = { at: now, snapshot };
    return snapshot;
  }

  roomVisits(roomId: RoomId): number {
    return this.metrics.roomVisits[roomId] ?? 0;
  }

  mostVisited(): { roomId: string; count: number } | null {
    return mostVisitedRoom(this.metrics);
  }
}
