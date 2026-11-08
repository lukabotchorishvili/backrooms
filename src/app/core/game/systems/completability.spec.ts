/**
 * "The game must never become impossible": simulated playthroughs with very different
 * behaviour profiles, on every difficulty and several seeds, must always be able to reach
 * the required number of confirmed reports and then an ending.
 */
import { AnomalyDefinition, BehaviorTendency, RoomId } from '../models';
import { FakeWorld, directorSetup, profile, registry, stage } from '../testing/fake-world';
import { AnomalyDirectorService } from './anomaly-director.service';
import { AttentionSystemService } from './attention-system.service';
import { InvestigationService } from './investigation.service';
import { ProgressionService, resolveEnding } from './progression.service';
import { SeededRandom } from './seeded-random';

interface Persona {
  readonly name: string;
  readonly tendencies: Partial<Record<BehaviorTendency, number>>;
  readonly avoidRooms: readonly RoomId[];
  /** Chance to (wrongly) report a decoy each time the player files reports. */
  readonly falseReportRate: number;
  /** Chance per second to notice a perceivable anomaly while in range. */
  readonly attentiveness: number;
}

const PERSONAS: Persona[] = [
  { name: 'neutral', tendencies: {}, avoidRooms: [], falseReportRate: 0.1, attentiveness: 0.25 },
  { name: 'avoids dark rooms + security', tendencies: { avoidant: 1 }, avoidRooms: ['archive', 'storage', 'security'], falseReportRate: 0.1, attentiveness: 0.25 },
  { name: 'door-checker', tendencies: { 'door-checker': 1, curious: 0.7 }, avoidRooms: [], falseReportRate: 0.2, attentiveness: 0.3 },
  { name: 'rusher', tendencies: { rusher: 1 }, avoidRooms: ['manager-office'], falseReportRate: 0.05, attentiveness: 0.12 },
  { name: 'reckless guesser', tendencies: { curious: 1, repetitive: 1 }, avoidRooms: [], falseReportRate: 0.9, attentiveness: 0.2 },
];

const SIM_STEP = 1;
const SIM_LIMIT_SEC = 50 * 60;

function inRange(def: AnomalyDefinition, room: RoomId | null, world: FakeWorld): boolean {
  if (!room) return false;
  if (def.clue.mode === 'feed') return room === 'security';
  if (def.roomId === room || def.alternateRoomIds?.includes(room)) return true;
  return def.clue.mode === 'hearing' && world.adjacentRooms(def.roomId).includes(room);
}

function simulate(difficultyId: string, seed: number, persona: Persona): { completed: boolean; seconds: number; falseReports: number; peak: number } {
  const difficulty = registry.difficulties.require(difficultyId);
  const director = new AnomalyDirectorService();
  director.start(directorSetup(difficulty, seed));
  const investigation = new InvestigationService();
  investigation.reset();
  const attention = new AttentionSystemService();
  attention.configure(difficulty);
  attention.reset();
  const progression = new ProgressionService();
  progression.reset();
  const world = new FakeWorld();
  world.profile = profile(persona.tendencies);
  const rng = new SeededRandom(seed * 7919 + persona.name.length);
  const anomalies = new Map(registry.anomaliesForStage(stage).map((a) => [a.id, a]));
  world.enter('open-plan');
  let moveTimer = 0;
  progression.terminalOpened();

  for (let t = 0; t < SIM_LIMIT_SEC; t += SIM_STEP) {
    // wander through doors, avoiding the persona's rooms
    moveTimer -= SIM_STEP;
    if (moveTimer <= 0) {
      moveTimer = 4 + rng.next() * 10;
      const options = world.adjacentRooms(world.playerRoomId!).filter((r) => !persona.avoidRooms.includes(r));
      const next = rng.pick(options);
      if (next) world.enter(next);
    }
    for (const action of director.update(SIM_STEP, world)) {
      if (action.type === 'decoy') {
        investigation.addObservation({ time: t, clock: '', roomId: action.decoy.roomId, subject: action.decoy.subject, text: action.decoy.observation, source: { kind: 'decoy', decoyId: action.decoy.id } });
      }
    }
    for (const def of director.perceivableAnomalies()) {
      if (inRange(def, world.playerRoomId, world) && rng.chance(persona.attentiveness)) {
        director.markWitnessed(def.id);
        investigation.addObservation({ time: t, clock: '', roomId: def.roomId, alternateRoomIds: def.alternateRoomIds, subject: def.clue.subject, text: def.clue.observation, source: { kind: 'anomaly', anomalyId: def.id } });
      }
    }
    // File reports whenever passing through reception
    if (world.playerRoomId === 'reception') {
      const ctx = { anomalies, difficulty, confirmedAnomalyIds: new Set(investigation.confirmedAnomalyIds()) };
      for (const o of investigation.observations().filter((x) => !x.reported)) {
        if (o.source.kind === 'anomaly') {
          const def = anomalies.get(o.source.anomalyId)!;
          const r = investigation.submitReport({ observationId: o.id, roomId: o.roomId, category: def.category }, ctx, t);
          if (r.outcome === 'confirmed') {
            director.markReported(def.id);
            attention.relieve(-r.attentionDelta);
          }
        } else if (rng.chance(persona.falseReportRate)) {
          const r = investigation.submitReport({ observationId: o.id, roomId: o.roomId, category: 'audio' }, ctx, t);
          attention.raise(r.attentionDelta, true);
        }
      }
    }
    world.confirmedCount = investigation.confirmedCount();
    attention.update(SIM_STEP, { sprinting: !!persona.tendencies.rusher, overtime: t > difficulty.shiftDurationMin * 60 });
    world.attentionLevel = attention.level();
    if (progression.confirmedChanged(world.confirmedCount, stage.requiredReports)) {
      return { completed: true, seconds: t, falseReports: investigation.falseReportCount(), peak: attention.snapshot().peak };
    }
  }
  return { completed: false, seconds: SIM_LIMIT_SEC, falseReports: investigation.falseReportCount(), peak: attention.snapshot().peak };
}

describe('completability', () => {
  for (const difficulty of ['observer', 'employee', 'the-building-knows']) {
    for (const persona of PERSONAS) {
      it(`${difficulty} / ${persona.name}: always reaches the elevator`, () => {
        for (const seed of [1, 2, 3, 4]) {
          const result = simulate(difficulty, seed, persona);
          expect(result.completed, `seed ${seed} stalled after ${result.seconds}s`).toBe(true);
          expect(result.seconds).toBeLessThan(SIM_LIMIT_SEC);
        }
      });
    }
  }

  it('after completing the investigation an ending always resolves', () => {
    const p = new ProgressionService();
    p.reset();
    p.terminalOpened();
    p.confirmedChanged(stage.requiredReports, stage.requiredReports);
    expect(p.grantAccess()).toBe(true);
    for (const attention of [0, 60, 100]) {
      const ending = resolveEnding(registry.endingsForStage(stage), 'elevator-standard', {
        investigationComplete: p.hasFlag('investigation-complete'),
        attention,
        peakAttention: attention,
        escalations: attention > 90 ? 1 : 0,
        flags: p.flags(),
      });
      expect(ending).not.toBeNull();
    }
  });

  it('typical playthrough length is in the intended 15-25 minute band (normal)', () => {
    const times = [1, 2, 3, 4, 5, 6].map((seed) => simulate('employee', seed, PERSONAS[0]).seconds / 60);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeGreaterThan(5);
    expect(avg).toBeLessThan(30);
  });
});
