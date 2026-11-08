import { Rect, Rgb, Vec3 } from './common.model';

/** Stable room identifier (unique within a stage). */
export type RoomId = string;

export type WallSide = 'north' | 'south' | 'east' | 'west';

/**
 * Procedural surface materials the engine knows how to generate.
 * Adding a new surface: add the id here and a recipe in engine/materials/material-library.ts.
 */
export const SURFACE_MATERIAL_IDS = [
  'carpet-blue',
  'carpet-brown',
  'carpet-gray',
  'carpet-green',
  'linoleum',
  'concrete',
  'terrazzo',
  'wall-beige',
  'wall-cream',
  'wall-green',
  'wall-gray',
  'wall-wood',
  'wall-concrete',
  'wall-blue',
  'ceiling-tile',
  'ceiling-concrete',
  'metal-brushed',
] as const;
export type SurfaceMaterialId = (typeof SURFACE_MATERIAL_IDS)[number];

/**
 * Prop archetypes the ObjectFactory can build procedurally.
 * Adding a new prop: add the id here and a builder in world/object-factory.ts
 * (the factory's builder table is typed as Record<PropType, ...> so the compiler enforces it).
 */
export const PROP_TYPES = [
  'desk',
  'cubicle-desk',
  'executive-desk',
  'reception-desk',
  'office-chair',
  'waiting-chair',
  'conference-table',
  'computer',
  'terminal',
  'phone',
  'desk-lamp',
  'plant',
  'filing-cabinet',
  'bookshelf',
  'metal-shelf',
  'archive-shelf',
  'boxes',
  'whiteboard',
  'projector-screen',
  'water-cooler',
  'printer',
  'vending-machine',
  'coffee-machine',
  'fridge',
  'microwave',
  'kitchen-counter',
  'dining-table',
  'painting',
  'poster',
  'wall-sign',
  'note',
  'calendar',
  'wall-clock',
  'exit-sign',
  'fire-extinguisher',
  'trash-can',
  'bench',
  'security-desk',
  'server-rack',
  'logbook',
  'nameplate',
  'photo-frame',
  'desk-fan',
  'curtains',
  'pa-speaker',
  'badge-reader',
  'elevator-call-panel',
  'elevator-indicator',
  'elevator-car-panel',
  'end-wall',
  'corridor-extension',
  'fake-door',
  'closet-vignette',
  'figure',
  'mop-bucket',
  'ladder',
  'breaker-panel',
  'key-hook',
  'memo',
  'water-fountain',
  'fire-alarm',
  'front-doors',
  'ceiling-vent',
  'wall-map',
  'radiator',
  'umbrella-stand',
  'mug',
  'paper-stack',
] as const;
export type PropType = (typeof PROP_TYPES)[number];

export type InteractionKind =
  /** Look closely: produces an observation note. */
  | 'inspect'
  /** Opens the investigation terminal UI. */
  | 'terminal'
  /** Opens the security monitor view. */
  | 'security-console'
  /** Elevator call button in the lobby. */
  | 'elevator-call'
  /** Floor panel inside the elevator car. */
  | 'elevator-panel'
  /** Picks up an item and sets a progression flag. */
  | 'pickup'
  /** Environmental interaction that calms the building (lowers attention). */
  | 'relief'
  /** Risky interaction that raises attention (may also set a flag). */
  | 'hazard';

export interface InteractionDefinition {
  readonly kind: InteractionKind;
  /** Display name of the object, e.g. "Wall clock". Used in prompts and notes. */
  readonly name: string;
  /** Verb shown in the prompt. Defaults by kind (Inspect / Use / Take ...). */
  readonly verb?: string;
  /** Observation text for the object's normal state. */
  readonly note?: string;
  /** Progression flag set when used (pickup / hazard). */
  readonly flag?: string;
  /** Interaction only available once this flag is set. */
  readonly requiresFlag?: string;
  /** Text shown when requiresFlag is missing. */
  readonly lockedNote?: string;
  /** Building attention change when used (negative calms the building). */
  readonly attentionDelta?: number;
  /** Seconds before the interaction can affect attention again. */
  readonly cooldownSec?: number;
  /** If true the prop disappears after use (pickups). */
  readonly consumed?: boolean;
}

export type PropParamValue = string | number | boolean;

export interface PropPlacement {
  /** Stable id, unique within the stage. Anomalies target props by this id. */
  readonly id: string;
  readonly type: PropType;
  /** Floor position (y = 0) or wall-mounted position (y = mounting height). */
  readonly position: Vec3;
  /** Rotation about Y in degrees. 0 faces -Z (south); props face "into" the room. */
  readonly rotationY?: number;
  readonly scale?: number;
  /** Visual variant understood by the prop builder (painting subject, plant species...). */
  readonly variant?: string;
  /** Free-form builder parameters (text, colours, dimensions). */
  readonly params?: Readonly<Record<string, PropParamValue>>;
  /** Initially hidden: revealed by anomalies or progression. */
  readonly hidden?: boolean;
  /** Override default collision for the type. */
  readonly solid?: boolean;
  /** Only rendered by security cameras, never by the player's camera. */
  readonly cameraOnly?: boolean;
  /** Room memory tracks this prop's baseline (defaults to true when interactive). */
  readonly tracked?: boolean;
  readonly interaction?: InteractionDefinition;
}

export type LightTone = 'cool' | 'neutral' | 'warm' | 'sickly' | 'emergency';

export interface LightDefinition {
  readonly id: string;
  /** Fixture position; y is usually room height. */
  readonly position: Vec3;
  readonly tone: LightTone;
  readonly intensity: number;
  readonly range: number;
  /** Fixture style; 'panel' renders a 2x2 ft fluorescent troffer. */
  readonly fixture: 'panel' | 'strip' | 'bulb' | 'none';
  /** Optional constant flicker (0 = none, 1 = very unstable). */
  readonly flicker?: number;
  /** Starts switched off (dark rooms). */
  readonly off?: boolean;
}

export interface WindowDefinition {
  readonly side: WallSide;
  /** Centre along the wall (world coordinate). */
  readonly center: number;
  readonly width: number;
  readonly sill: number;
  readonly top: number;
  readonly blinds?: boolean;
}

/** A plain gap cut into a wall, filled by a prop (front doors, closet door...). */
export interface WallOpeningDefinition {
  readonly side: WallSide;
  readonly center: number;
  readonly width: number;
  readonly height: number;
}

export interface RoomAmbience {
  /** 0 = brightly lit, 1 = pitch black. Rooms >= 0.5 count as "dark areas". */
  readonly darkness: number;
  /** Looping ambience sound ids layered while the player is inside. */
  readonly soundscape: readonly string[];
  readonly floorSound: 'carpet' | 'hard';
  /** Fog tint override for this room. */
  readonly fogTint?: Rgb;
}

export interface RoomDefinition {
  readonly id: RoomId;
  readonly name: string;
  /** Short description used by the terminal / documentation. */
  readonly description: string;
  /** Main rectangle; walls are generated around it. */
  readonly bounds: Rect;
  /** Additional walkable areas that belong to the room (no walls generated). */
  readonly extraBounds?: readonly Rect[];
  readonly height: number;
  readonly surfaces: {
    readonly floor: SurfaceMaterialId;
    readonly walls: SurfaceMaterialId;
    readonly ceiling: SurfaceMaterialId;
  };
  /** Wall sides that are NOT generated (replaced by props such as a movable end wall). */
  readonly openSides?: readonly WallSide[];
  readonly windows?: readonly WindowDefinition[];
  readonly openings?: readonly WallOpeningDefinition[];
  readonly lights: readonly LightDefinition[];
  readonly props: readonly PropPlacement[];
  readonly ambience: RoomAmbience;
  readonly tags?: readonly string[];
}

export type DoorState = 'open' | 'closed' | 'locked';
export type DoorStyle = 'wood' | 'glass' | 'double-wood' | 'double-glass' | 'metal';

export interface DoorDefinition {
  readonly id: string;
  readonly rooms: readonly [RoomId, RoomId];
  /** 'x' = the wall lies on a constant X (runs north-south); 'z' = constant Z. */
  readonly axis: 'x' | 'z';
  /** The constant coordinate of the wall line. */
  readonly at: number;
  /** Centre of the opening along the wall. */
  readonly center: number;
  readonly width: number;
  readonly height: number;
  readonly style: DoorStyle;
  readonly initialState: DoorState;
  /** Nameplate text shown beside the door (registered as prop `sign-<doorId>`). */
  readonly sign?: string;
  /** Which room the nameplate faces. Defaults to rooms[0]. */
  readonly signRoom?: RoomId;
  /** Text shown when a locked door is tried. */
  readonly lockedNote?: string;
}

export interface SecurityCameraDefinition {
  readonly id: string;
  readonly label: string;
  readonly roomId: RoomId;
  readonly position: Vec3;
  readonly target: Vec3;
  /** Field of view in degrees. */
  readonly fov?: number;
  /** Extra rooms whose meshes are visible to this camera (through doors / glass). */
  readonly alsoSees?: readonly RoomId[];
}

export interface ElevatorDefinition {
  readonly lobbyRoomId: RoomId;
  /** Wall line of the elevator doors (same convention as DoorDefinition). */
  readonly axis: 'x' | 'z';
  readonly at: number;
  readonly center: number;
  readonly width: number;
  readonly height: number;
  /** Interior of the car (must be inside the lobby's extraBounds). */
  readonly car: Rect;
  readonly floorLabel: string;
  /** Centre of a decorative, permanently closed second elevator (optional). */
  readonly secondaryCenter?: number;
  readonly callPanelPropId: string;
  readonly carPanelPropId: string;
  readonly indicatorPropId: string;
}
