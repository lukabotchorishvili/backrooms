import {
  AnomalyDefinition,
  BehaviorResponseDefinition,
  DecoyDefinition,
  DifficultyConfig,
  EndingDefinition,
  SoundDefinition,
  StageDefinition,
} from '../models';
import { FLOOR_14_ANOMALIES } from './anomalies/floor-14.anomalies';
import { FLOOR_14_DECOYS } from './anomalies/floor-14.decoys';
import { SOUND_LIBRARY } from './audio/sound-library';
import { BEHAVIOR_RESPONSES } from './behavior/behavior-responses';
import { DEFAULT_DIFFICULTY_ID, DIFFICULTIES } from './difficulties/difficulties';
import { ENDINGS } from './endings/endings';
import { FLOOR_14 } from './stages/floor-14/floor-14.stage';

interface Identified {
  readonly id: string;
}

/** A keyed collection that refuses duplicate ids (stable content ids are a hard rule). */
export class ContentCollection<T extends Identified> {
  private readonly items = new Map<string, T>();

  constructor(private readonly kind: string) {}

  register(item: T): void {
    if (this.items.has(item.id)) {
      throw new Error(`[content] Duplicate ${this.kind} id "${item.id}"`);
    }
    this.items.set(item.id, item);
  }

  registerAll(items: readonly T[]): void {
    items.forEach((i) => this.register(i));
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  require(id: string): T {
    const item = this.items.get(id);
    if (!item) throw new Error(`[content] Unknown ${this.kind} id "${id}"`);
    return item;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }
}

/**
 * Central registry for all data-driven content. New stages / anomalies / difficulties /
 * endings / responses / sounds are registered here (see GAME_DESIGN_AND_EXPANSION.md).
 */
export class ContentRegistry {
  readonly stages = new ContentCollection<StageDefinition>('stage');
  readonly anomalies = new ContentCollection<AnomalyDefinition>('anomaly');
  readonly decoys = new ContentCollection<DecoyDefinition>('decoy');
  readonly difficulties = new ContentCollection<DifficultyConfig>('difficulty');
  readonly endings = new ContentCollection<EndingDefinition>('ending');
  readonly behaviorResponses = new ContentCollection<BehaviorResponseDefinition>('behavior response');
  readonly sounds = new ContentCollection<SoundDefinition>('sound');

  defaultStageId = FLOOR_14.id;
  defaultDifficultyId = DEFAULT_DIFFICULTY_ID;

  sortedDifficulties(): DifficultyConfig[] {
    return this.difficulties.all().sort((a, b) => a.order - b.order);
  }

  anomaliesForStage(stage: StageDefinition): AnomalyDefinition[] {
    return stage.anomalyIds.map((id) => this.anomalies.require(id));
  }

  decoysForStage(stage: StageDefinition): DecoyDefinition[] {
    return stage.decoyIds.map((id) => this.decoys.require(id));
  }

  endingsForStage(stage: StageDefinition): EndingDefinition[] {
    return stage.endingIds.map((id) => this.endings.require(id));
  }

  responsesForStage(stage: StageDefinition): BehaviorResponseDefinition[] {
    return stage.behaviorResponseIds.map((id) => this.behaviorResponses.require(id));
  }
}

/** Builds a registry populated with all built-in content. */
export function createDefaultContentRegistry(): ContentRegistry {
  const registry = new ContentRegistry();
  registry.difficulties.registerAll(DIFFICULTIES);
  registry.endings.registerAll(ENDINGS);
  registry.behaviorResponses.registerAll(BEHAVIOR_RESPONSES);
  registry.anomalies.registerAll(FLOOR_14_ANOMALIES);
  registry.decoys.registerAll(FLOOR_14_DECOYS);
  registry.sounds.registerAll(SOUND_LIBRARY);
  registry.stages.register(FLOOR_14);
  return registry;
}

/** Shared singleton used by the Angular services (tests create their own). */
export const CONTENT = createDefaultContentRegistry();
