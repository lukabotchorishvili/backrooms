import { Vec3 } from './common.model';
import {
  DoorDefinition,
  ElevatorDefinition,
  RoomDefinition,
  RoomId,
  SecurityCameraDefinition,
} from './room.model';

export type StageId = string;

export const OBJECTIVE_IDS = [
  'find-terminal',
  'investigate',
  'request-access',
  'take-elevator',
  'complete',
] as const;
export type ObjectiveId = (typeof OBJECTIVE_IDS)[number];

/**
 * A stage (floor) is pure configuration. The engine builds whatever a StageDefinition
 * describes; systems read its anomaly pool, decoys, endings and objectives.
 *
 * Stage lifecycle (see GameSessionService):
 *   load config -> validate -> build environment -> register anomalies ->
 *   init stage behaviour -> gameplay -> track completion -> ending/transition -> dispose
 */
export interface StageDefinition {
  readonly id: StageId;
  readonly name: string;
  /** Label shown in-world and in menus, e.g. "FLOOR 14". */
  readonly floorLabel: string;
  readonly description: string;
  /** Employee number used in in-world text ({employee} token). */
  readonly employeeNumber: string;
  readonly companyName: string;

  readonly rooms: readonly RoomDefinition[];
  readonly doors: readonly DoorDefinition[];
  readonly securityCameras: readonly SecurityCameraDefinition[];
  readonly elevator: ElevatorDefinition;

  readonly spawn: { readonly position: Vec3; readonly yawDeg: number; readonly pitchDeg: number };
  /** Room containing the investigation terminal. */
  readonly hubRoomId: RoomId;
  readonly terminalPropId: string;

  /** Correct reports needed to unlock the elevator. */
  readonly requiredReports: number;
  /** Anomaly ids (from the anomaly registry) available on this stage. */
  readonly anomalyIds: readonly string[];
  /** Always-eligible anomalies used when nothing else qualifies. */
  readonly fallbackAnomalyIds: readonly string[];
  readonly decoyIds: readonly string[];
  readonly behaviorResponseIds: readonly string[];
  readonly endingIds: readonly string[];

  readonly objectives: Readonly<Record<ObjectiveId, string>>;
  readonly intro: {
    readonly lines: readonly string[];
    readonly tutorial: readonly string[];
  };
  readonly terminal: {
    readonly header: string;
    readonly bootLines: readonly string[];
    readonly instructions: readonly string[];
  };
  /** Routine PA announcements used as atmosphere/decoys. */
  readonly music: { readonly ambient: string; readonly tension: string };
  /** Next stage after a successful exit (future floors). */
  readonly nextStageId?: StageId;
}
