import {
  InteractionDefinition,
  PropPlacement,
  PropType,
  Rect,
  Vec3,
  WallSide,
} from '../../models';

/** Distance from the wall line at which wall-mounted props are placed. */
export const WALL_INSET = 0.15;

/**
 * Position + rotation for a prop mounted on the inside of a room wall.
 * Rotation convention: a prop's front is its local -Z. 0 = faces south, 90 = west,
 * 180 = north, 270 = east.
 */
export function onWall(
  room: Rect,
  side: WallSide,
  along: number,
  y: number,
  depth = 0,
): { position: Vec3; rotationY: number } {
  const d = WALL_INSET + depth;
  switch (side) {
    case 'north':
      return { position: [along, y, room.z1 - d], rotationY: 0 };
    case 'south':
      return { position: [along, y, room.z0 + d], rotationY: 180 };
    case 'west':
      return { position: [room.x0 + d, y, along], rotationY: 270 };
    case 'east':
      return { position: [room.x1 - d, y, along], rotationY: 90 };
  }
}

export function wallProp(
  id: string,
  type: PropType,
  room: Rect,
  side: WallSide,
  along: number,
  y: number,
  extra: Partial<PropPlacement> = {},
  depth = 0,
): PropPlacement {
  return { id, type, ...onWall(room, side, along, y, depth), ...extra };
}

export function inspect(name: string, note: string): InteractionDefinition {
  return { kind: 'inspect', name, note };
}

/**
 * A cubicle workstation: desk + monitor + chair.
 * facing = the direction the seated worker looks ('north' or 'south').
 */
export function workstation(
  index: string,
  x: number,
  z: number,
  facing: 'north' | 'south',
  options: {
    monitorId?: string;
    chairId?: string;
    monitorInteraction?: InteractionDefinition;
    chairInteraction?: InteractionDefinition;
    chairSolid?: boolean;
    screen?: string;
    chairRotationOffset?: number;
  } = {},
): PropPlacement[] {
  // Desk front (the side the worker sits on) faces the worker's back direction.
  const deskRot = facing === 'north' ? 0 : 180;
  const towardWorker = facing === 'north' ? -1 : 1;
  const chairRot = (facing === 'north' ? 180 : 0) + (options.chairRotationOffset ?? 0);
  return [
    { id: `opn-desk-${index}`, type: 'cubicle-desk', position: [x, 0, z], rotationY: deskRot },
    {
      id: options.monitorId ?? `opn-monitor-${index}`,
      type: 'computer',
      position: [x + 0.15, 0.75, z - towardWorker * 0.12],
      rotationY: deskRot,
      params: { screen: options.screen ?? 'login' },
      interaction: options.monitorInteraction,
    },
    {
      id: options.chairId ?? `opn-chair-${index}`,
      type: 'office-chair',
      position: [x - 0.1, 0, z + towardWorker * 0.78],
      rotationY: chairRot,
      solid: options.chairSolid,
      interaction: options.chairInteraction,
    },
  ];
}
