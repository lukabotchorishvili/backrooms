import { PropPlacement, Rect, RoomDefinition } from '../../../models';
import { inspect, wallProp, workstation } from '../stage-helpers';

/*
 * FLOOR 14 - layout (metres, +X east, +Z north)
 *
 *  z=31  +---------+---------+--------+--------+
 *        | MANAGER | BREAK   | ARCHIVE| STORAGE|        +--------+
 *  z=23  +----d----+----d----+---d----+---d----+--------|SECURITY|
 *        |            EMPLOYEE CORRIDOR          d       |        |
 *  z=20  +-------d-----------------+------d------+       | x14-20 |
 *        |      OPEN-PLAN OFFICE    d CONFERENCE  |       | z14-26 |
 *  z=10  +-------------+----d------+------d------+       +--------+
 *                      |RECEPTION  d ELEV. LOBBY |[car]
 *  z=0                 +-----------+-------------+
 *        x=-18        -6    0      6            14
 */

export const R_RECEPTION: Rect = { x0: -6, z0: 0, x1: 6, z1: 10 };
export const R_LOBBY: Rect = { x0: 6, z0: 0, x1: 14, z1: 10 };
export const R_OPEN: Rect = { x0: -18, z0: 10, x1: 6, z1: 20 };
export const R_CONFERENCE: Rect = { x0: 6, z0: 10, x1: 14, z1: 20 };
export const R_CORRIDOR: Rect = { x0: -18, z0: 20, x1: 14, z1: 23 };
export const R_MANAGER: Rect = { x0: -18, z0: 23, x1: -9, z1: 31 };
export const R_BREAK: Rect = { x0: -9, z0: 23, x1: 0, z1: 31 };
export const R_ARCHIVE: Rect = { x0: 0, z0: 23, x1: 8, z1: 31 };
export const R_STORAGE: Rect = { x0: 8, z0: 23, x1: 14, z1: 31 };
export const R_SECURITY: Rect = { x0: 14, z0: 14, x1: 20, z1: 26 };

export const ELEVATOR_CAR: Rect = { x0: 14, z0: 1.8, x1: 16.6, z1: 4.2 };
export const CORRIDOR_EXTENSION: Rect = { x0: -24.6, z0: 20, x1: -18, z1: 23 };
export const STORAGE_CLOSET: Rect = { x0: 10.9, z0: 31, x1: 12.1, z1: 33 };

/* ----------------------------------------------------------------------------------------- */
/* 1. RECEPTION                                                                               */
/* ----------------------------------------------------------------------------------------- */

const receptionProps: PropPlacement[] = [
  {
    id: 'rec-desk',
    type: 'reception-desk',
    position: [0, 0, 6.2],
    rotationY: 180,
    interaction: inspect(
      'Reception desk',
      'Reception desk. Laminate worn pale where elbows rested. A sign-in sheet with no names.',
    ),
  },
  {
    id: 'rec-terminal',
    type: 'terminal',
    position: [0.75, 1.08, 6.38],
    rotationY: 180,
    interaction: { kind: 'terminal', name: 'Inspection terminal', verb: 'Use' },
  },
  {
    id: 'rec-phone',
    type: 'phone',
    position: [-0.9, 1.08, 6.35],
    rotationY: 200,
    interaction: inspect(
      'Desk phone',
      'Desk phone. A red light blinks: 1 NEW MESSAGE. The handset is cold.',
    ),
  },
  { id: 'rec-papers', type: 'paper-stack', position: [-0.2, 1.08, 6.3], rotationY: 170 },
  {
    id: 'rec-front-doors',
    type: 'front-doors',
    position: [0, 0, 0],
    rotationY: 180,
    interaction: inspect(
      'Front entrance',
      'Front entrance. Locked from the outside. Through the glass: only fog, lit from nowhere.',
    ),
  },
  wallProp('rec-logo', 'wall-sign', R_RECEPTION, 'south', 0, 2.95, {
    variant: 'logo',
    params: { text: 'HALDANE STRATA GROUP', sub: 'FLOOR 14' },
  }),
  wallProp('rec-badge-reader', 'badge-reader', R_RECEPTION, 'south', 2.4, 1.3, {
    interaction: {
      kind: 'relief',
      name: 'Badge reader',
      verb: 'Scan badge',
      note: 'Badge reader. STATUS: COMPLIANT. The hum in the walls softens a little.',
      attentionDelta: -6,
      cooldownSec: 150,
    },
  }),
  wallProp('rec-clock', 'wall-clock', R_RECEPTION, 'east', 8.3, 2.55, {
    interaction: inspect(
      'Wall clock',
      'Wall clock. A sticky note under it: "IT RUNS SLOW. DO NOT ADJUST."',
    ),
  }),
  wallProp('rec-painting', 'painting', R_RECEPTION, 'west', 5, 1.75, {
    variant: 'lake',
    interaction: inspect('Painting', 'Painting. A grey lake under a white sky. No horizon line.'),
  }),
  wallProp('rec-directory', 'wall-sign', R_RECEPTION, 'north', 2.6, 1.55, {
    variant: 'directory',
    params: {
      text: 'FLOOR 14 DIRECTORY|RECEPTION|ELEVATORS|OPEN OFFICE|CONFERENCE A|EMPLOYEE CORRIDOR|MANAGER|BREAK ROOM|ARCHIVE|STORAGE|SECURITY',
    },
    interaction: inspect('Floor directory', 'Floor directory. Ten rooms are listed, plus Reception.'),
  }),
  {
    id: 'rec-plant',
    type: 'plant',
    position: [-5.2, 0, 9.2],
    variant: 'red',
    interaction: inspect('Potted plant', 'Potted plant. Deep red leaves, glossy as if wet.'),
  },
  { id: 'rec-plant-2', type: 'plant', position: [5.25, 0, 0.75], variant: 'fern' },
  {
    id: 'rec-chair-1',
    type: 'waiting-chair',
    position: [-5.35, 0, 1.6],
    rotationY: 270,
    interaction: inspect('Waiting chair', 'Waiting chair. The cushion holds the shape of someone.'),
  },
  { id: 'rec-chair-2', type: 'waiting-chair', position: [-5.35, 0, 2.4], rotationY: 270 },
  { id: 'rec-chair-3', type: 'waiting-chair', position: [-5.35, 0, 3.2], rotationY: 270 },
  { id: 'rec-umbrella', type: 'umbrella-stand', position: [-2.4, 0, 0.55] },
  { id: 'rec-trash', type: 'trash-can', position: [1.9, 0, 6.6] },
  wallProp('rec-pa', 'pa-speaker', R_RECEPTION, 'east', 1.2, 3.0),
];

export const ROOM_RECEPTION: RoomDefinition = {
  id: 'reception',
  name: 'Reception',
  description: 'The hub of the floor. Investigation terminal, front entrance, floor directory.',
  bounds: R_RECEPTION,
  height: 3.4,
  surfaces: { floor: 'terrazzo', walls: 'wall-cream', ceiling: 'ceiling-tile' },
  openings: [{ side: 'south', center: 0, width: 3.2, height: 2.6 }],
  lights: [
    { id: 'rec-light-1', position: [-3, 3.4, 3], tone: 'warm', intensity: 0.75, range: 10, fixture: 'panel' },
    { id: 'rec-light-2', position: [3, 3.4, 3], tone: 'warm', intensity: 0.75, range: 10, fixture: 'panel' },
    { id: 'rec-light-3', position: [-3, 3.4, 7.5], tone: 'warm', intensity: 0.8, range: 10, fixture: 'panel' },
    { id: 'rec-light-4', position: [3, 3.4, 7.5], tone: 'warm', intensity: 0.8, range: 10, fixture: 'panel' },
  ],
  props: receptionProps,
  ambience: { darkness: 0.1, soundscape: ['amb-fluorescent'], floorSound: 'hard' },
  tags: ['hub'],
};

/* ----------------------------------------------------------------------------------------- */
/* 2. ELEVATOR LOBBY                                                                          */
/* ----------------------------------------------------------------------------------------- */

export const ROOM_LOBBY: RoomDefinition = {
  id: 'elevator-lobby',
  name: 'Elevator lobby',
  description: 'Two elevators. One works - once the inspection is complete.',
  bounds: R_LOBBY,
  extraBounds: [ELEVATOR_CAR],
  height: 3.4,
  surfaces: { floor: 'terrazzo', walls: 'wall-gray', ceiling: 'ceiling-tile' },
  lights: [
    { id: 'lob-light-1', position: [10, 3.4, 3], tone: 'cool', intensity: 0.7, range: 9, fixture: 'panel' },
    { id: 'lob-light-2', position: [10, 3.4, 7.5], tone: 'cool', intensity: 0.65, range: 9, fixture: 'panel' },
  ],
  props: [
    wallProp('lob-call-panel', 'elevator-call-panel', R_LOBBY, 'east', 5, 1.2, {
      interaction: { kind: 'elevator-call', name: 'Elevator call button', verb: 'Press' },
    }),
    wallProp('lob-indicator', 'elevator-indicator', R_LOBBY, 'east', 3, 2.6),
    wallProp('lob-indicator-2', 'elevator-indicator', R_LOBBY, 'east', 7, 2.6, { variant: 'dead' }),
    wallProp('lob-oos-note', 'note', R_LOBBY, 'east', 7, 1.45, {
      params: { text: 'OUT OF|SERVICE' },
      interaction: inspect('Elevator B', 'Elevator B. OUT OF SERVICE. The note is older than the paint.'),
    }),
    wallProp('lob-floor-sign', 'wall-sign', R_LOBBY, 'east', 5, 2.95, {
      variant: 'floor-number',
      params: { text: '14' },
    }),
    { id: 'lob-bench', type: 'bench', position: [8.2, 0, 9.4], rotationY: 0 },
    wallProp('lob-extinguisher', 'fire-extinguisher', R_LOBBY, 'south', 12.4, 0.95),
    { id: 'lob-plant', type: 'plant', position: [6.8, 0, 0.75], variant: 'ficus' },
    { id: 'lob-trash', type: 'trash-can', position: [12.9, 0, 9.4] },
    {
      id: 'lob-car-panel',
      type: 'elevator-car-panel',
      position: [16.45, 1.2, 3.75],
      rotationY: 90,
      interaction: { kind: 'elevator-panel', name: 'Floor panel', verb: 'Use' },
    },
  ],
  ambience: { darkness: 0.15, soundscape: ['amb-hum'], floorSound: 'hard' },
  tags: ['exit'],
};

/* ----------------------------------------------------------------------------------------- */
/* 3. OPEN-PLAN OFFICE                                                                        */
/* ----------------------------------------------------------------------------------------- */

const openProps: PropPlacement[] = [
  // South band (z 12.4 facing north / 13.35 facing south)
  ...workstation('1', -15.2, 12.4, 'north'),
  ...workstation('2', -13.5, 12.4, 'north', {
    monitorId: 'opn-player-monitor',
    chairId: 'opn-player-chair',
    chairSolid: false,
    screen: 'player',
    monitorInteraction: inspect(
      'Your computer',
      'Your computer. Logged in as EMPLOYEE 4471. The cursor blinks in an empty document.',
    ),
  }),
  ...workstation('3', -9.8, 12.4, 'north', {
    chairInteraction: inspect('Office chair', 'Office chair. Pushed in neatly, facing the desk.'),
  }),
  ...workstation('4', -8.1, 12.4, 'north'),
  ...workstation('5', -15.2, 13.35, 'south', {
    monitorInteraction: inspect('Computer (desk 5)', 'Computer. A screensaver: the company logo, drifting slowly.'),
    screen: 'screensaver',
  }),
  ...workstation('6', -13.5, 13.35, 'south', { chairRotationOffset: 180 }),
  ...workstation('7', -9.8, 13.35, 'south', {
    monitorInteraction: inspect('Computer (desk 7)', 'Computer. A login screen: USER 0007. Password hint: "WHO YOU WERE".'),
  }),
  ...workstation('8', -8.1, 13.35, 'south', {
    monitorInteraction: inspect('Computer (desk 8)', 'Computer. A spreadsheet of names. Each row ends with "RELOCATED".'),
  }),
  // North band
  ...workstation('9', -15.2, 16.4, 'north'),
  ...workstation('10', -13.5, 16.4, 'north'),
  ...workstation('11', -15.2, 17.35, 'south'),
  ...workstation('12', -13.5, 17.35, 'south'),
  {
    id: 'opn-player-mug',
    type: 'mug',
    position: [-13.0, 0.75, 12.55],
    interaction: inspect('Your mug', 'Your mug. "WORLD\'S OKAYEST EMPLOYEE". The coffee is still warm.'),
  },
  {
    id: 'opn-nameplate',
    type: 'nameplate',
    position: [-14.05, 0.75, 12.2],
    rotationY: 0,
    params: { text: 'EMPLOYEE 4471' },
  },
  { id: 'opn-fan', type: 'desk-fan', position: [-15.6, 0.75, 13.55], rotationY: 180 },
  { id: 'opn-papers-1', type: 'paper-stack', position: [-8.4, 0.75, 12.5], rotationY: 12 },
  { id: 'opn-papers-2', type: 'paper-stack', position: [-15.6, 0.75, 16.55], rotationY: -8 },
  { id: 'opn-lamp', type: 'desk-lamp', position: [-9.3, 0.75, 13.25], rotationY: 160 },
  {
    id: 'opn-printer',
    type: 'printer',
    position: [-3.2, 0, 19.4],
    rotationY: 0,
    interaction: inspect(
      'Photocopier',
      'Photocopier. A sheet is stuck in the tray: a floor plan of this floor, slightly wrong.',
    ),
  },
  {
    id: 'opn-cooler',
    type: 'water-cooler',
    position: [-1.7, 0, 19.55],
    rotationY: 0,
    interaction: inspect('Water cooler', 'Water cooler. Half full. A single paper cup, unused.'),
  },
  { id: 'opn-plant-1', type: 'plant', position: [5.3, 0, 19.3], variant: 'fern' },
  { id: 'opn-plant-2', type: 'plant', position: [-17.3, 0, 10.7], variant: 'ficus' },
  wallProp('opn-calendar', 'calendar', R_OPEN, 'south', -9, 1.6, {
    params: { month: 'NOVEMBER', note: '' },
    interaction: inspect('Wall calendar', 'Wall calendar. November. Every day is crossed out except today.'),
  }),
  wallProp('opn-poster', 'poster', R_OPEN, 'south', -15, 1.6, {
    variant: 'always-here',
    interaction: inspect('Poster', 'Poster: "WE ARE ALWAYS HERE FOR YOU." Two faded silhouettes shaking hands.'),
  }),
  wallProp('opn-filing-1', 'filing-cabinet', R_OPEN, 'east', 11.3, 0),
  wallProp('opn-filing-2', 'filing-cabinet', R_OPEN, 'east', 12.1, 0, {
    interaction: inspect('Filing cabinet', 'Filing cabinet. The top drawer is labelled "PREVIOUS INSPECTORS". It is full.'),
  }),
  { id: 'opn-trash-1', type: 'trash-can', position: [-11.6, 0, 11.2] },
  { id: 'opn-trash-2', type: 'trash-can', position: [-6.9, 0, 14.2] },
  { id: 'opn-vent', type: 'ceiling-vent', position: [-9, 3.0, 15] },
  wallProp('opn-sign-reception', 'wall-sign', R_OPEN, 'south', 2.2, 2.3, {
    variant: 'arrow',
    params: { text: 'RECEPTION  ←' },
  }),
];

export const ROOM_OPEN_PLAN: RoomDefinition = {
  id: 'open-plan',
  name: 'Open-plan office',
  description: 'Twelve cubicles. Yours is the one with the warm coffee.',
  bounds: R_OPEN,
  height: 3.0,
  surfaces: { floor: 'carpet-blue', walls: 'wall-beige', ceiling: 'ceiling-tile' },
  windows: [
    { side: 'west', center: 12.6, width: 2.2, sill: 0.9, top: 2.4, blinds: true },
    { side: 'west', center: 17.4, width: 2.2, sill: 0.9, top: 2.4, blinds: true },
  ],
  lights: [
    { id: 'opn-light-1', position: [-14.4, 3, 12.9], tone: 'cool', intensity: 0.7, range: 8.5, fixture: 'panel' },
    { id: 'opn-light-2', position: [-9, 3, 12.9], tone: 'cool', intensity: 0.65, range: 8.5, fixture: 'panel' },
    { id: 'opn-light-3', position: [-14.4, 3, 17], tone: 'cool', intensity: 0.6, range: 8.5, fixture: 'panel', flicker: 0.08 },
    { id: 'opn-light-4', position: [-1.5, 3, 15.5], tone: 'neutral', intensity: 0.7, range: 9.5, fixture: 'panel' },
  ],
  props: openProps,
  ambience: { darkness: 0.2, soundscape: ['amb-office', 'amb-vent'], floorSound: 'carpet' },
};

/* ----------------------------------------------------------------------------------------- */
/* 4. CONFERENCE ROOM                                                                         */
/* ----------------------------------------------------------------------------------------- */

const conferenceChairs: PropPlacement[] = [13.2, 14.4, 15.6, 16.8].flatMap((z, i) => [
  { id: `cnf-chair-${i * 2 + 1}`, type: 'office-chair', position: [8.75, 0, z], rotationY: 270 } as PropPlacement,
  { id: `cnf-chair-${i * 2 + 2}`, type: 'office-chair', position: [11.25, 0, z], rotationY: 90 } as PropPlacement,
]);

export const ROOM_CONFERENCE: RoomDefinition = {
  id: 'conference',
  name: 'Conference room',
  description: 'Conference A. A long table, eight chairs, a speakerphone.',
  bounds: R_CONFERENCE,
  height: 3.0,
  surfaces: { floor: 'carpet-gray', walls: 'wall-wood', ceiling: 'ceiling-tile' },
  lights: [
    { id: 'cnf-light-1', position: [10, 3, 13], tone: 'neutral', intensity: 0.7, range: 8, fixture: 'panel' },
    { id: 'cnf-light-2', position: [10, 3, 17], tone: 'neutral', intensity: 0.7, range: 8, fixture: 'panel' },
  ],
  props: [
    {
      id: 'cnf-table',
      type: 'conference-table',
      position: [10, 0, 15],
      rotationY: 90,
      interaction: inspect('Conference table', 'Conference table. Eight chairs, neatly tucked in.'),
    },
    ...conferenceChairs,
    {
      id: 'cnf-speakerphone',
      type: 'phone',
      variant: 'speaker',
      position: [10, 0.76, 15],
      interaction: inspect('Speakerphone', 'Speakerphone. Three-legged, grey. The call light is off.'),
    },
    { id: 'cnf-papers', type: 'paper-stack', position: [9.6, 0.76, 13.6], rotationY: 80 },
    wallProp('cnf-whiteboard', 'whiteboard', R_CONFERENCE, 'north', 8.1, 1.45, {
      params: { text: 'Q3 OBJECTIVES|- RETAIN STAFF|- REDUCE EXITS|- KEEP SMILING' },
      interaction: inspect('Whiteboard', 'Whiteboard. "Q3 OBJECTIVES: RETAIN STAFF. REDUCE EXITS. KEEP SMILING."'),
    }),
    wallProp('cnf-screen', 'projector-screen', R_CONFERENCE, 'south', 8.4, 1.7),
    wallProp('cnf-clock', 'wall-clock', R_CONFERENCE, 'east', 15, 2.4, {
      interaction: inspect('Wall clock', 'Wall clock. Ticking steadily.'),
    }),
    { id: 'cnf-plant', type: 'plant', position: [13.3, 0, 19.3], variant: 'fern' },
  ],
  ambience: { darkness: 0.2, soundscape: ['amb-hum'], floorSound: 'carpet' },
};

/* ----------------------------------------------------------------------------------------- */
/* 5. EMPLOYEE CORRIDOR                                                                       */
/* ----------------------------------------------------------------------------------------- */

export const ROOM_CORRIDOR: RoomDefinition = {
  id: 'employee-corridor',
  name: 'Employee corridor',
  description: 'Thirty-two metres of fluorescent light. Ends at an emergency exit.',
  bounds: R_CORRIDOR,
  extraBounds: [CORRIDOR_EXTENSION],
  height: 3.0,
  openSides: ['west'],
  surfaces: { floor: 'carpet-green', walls: 'wall-beige', ceiling: 'ceiling-tile' },
  lights: [
    { id: 'cor-light-1', position: [-14, 3, 21.5], tone: 'cool', intensity: 0.6, range: 9, fixture: 'panel' },
    { id: 'cor-light-2', position: [-5.5, 3, 21.5], tone: 'cool', intensity: 0.6, range: 9, fixture: 'panel', flicker: 0.2 },
    { id: 'cor-light-3', position: [3, 3, 21.5], tone: 'cool', intensity: 0.6, range: 9, fixture: 'panel' },
    { id: 'cor-light-4', position: [11, 3, 21.5], tone: 'cool', intensity: 0.6, range: 9, fixture: 'panel' },
  ],
  props: [
    {
      id: 'cor-end-wall',
      type: 'end-wall',
      position: [-18, 0, 21.5],
      rotationY: 270,
      params: { width: 3, height: 3 },
      interaction: inspect(
        'Emergency exit',
        'Emergency exit. "ALARM WILL SOUND." The push bar will not move.',
      ),
    },
    {
      id: 'cor-extension',
      type: 'corridor-extension',
      position: [-18, 0, 21.5],
      rotationY: 270,
      params: { length: 6.4, width: 3, height: 3 },
      hidden: true,
    },
    wallProp('cor-poster-1', 'poster', R_CORRIDOR, 'north', -9, 1.6, {
      variant: 'teamwork',
      interaction: inspect('Poster', 'Poster: "TEAMWORK - NONE OF US IS AS SMART AS ALL OF US."'),
    }),
    wallProp('cor-poster-2', 'poster', R_CORRIDOR, 'south', -12, 1.6, {
      variant: 'safety',
      interaction: inspect('Poster', 'Poster: "SAFETY FIRST. REPORT ALL IRREGULARITIES."'),
    }),
    wallProp('cor-map', 'wall-map', R_CORRIDOR, 'south', 2.5, 1.55, {
      interaction: inspect('Floor map', 'Floor map. "YOU ARE HERE" - the red dot is worn through the paper.'),
    }),
    wallProp('cor-fountain', 'water-fountain', R_CORRIDOR, 'north', -0.4, 0),
    wallProp('cor-alarm', 'fire-alarm', R_CORRIDOR, 'south', -15.5, 1.35, {
      interaction: {
        kind: 'hazard',
        name: 'Fire alarm',
        verb: 'Pull',
        note: 'Fire alarm. You pull it. Nothing rings. Something, somewhere, listens.',
        attentionDelta: 8,
        cooldownSec: 45,
      },
    }),
    wallProp('cor-pa', 'pa-speaker', R_CORRIDOR, 'north', 7.5, 2.7),
    wallProp('cor-extinguisher', 'fire-extinguisher', R_CORRIDOR, 'north', -16.4, 0.95),
    { id: 'cor-exit-sign', type: 'exit-sign', position: [0, 2.72, 21.5], rotationY: 90, params: { arrow: 'right' } },
    { id: 'cor-vent', type: 'ceiling-vent', position: [-10, 3.0, 21.5] },
  ],
  ambience: { darkness: 0.25, soundscape: ['amb-fluorescent', 'amb-vent'], floorSound: 'carpet' },
};

/* ----------------------------------------------------------------------------------------- */
/* 6. MANAGER'S OFFICE                                                                        */
/* ----------------------------------------------------------------------------------------- */

export const ROOM_MANAGER: RoomDefinition = {
  id: 'manager-office',
  name: "Manager's office",
  description: 'R. Haldane, Floor Manager. Wood panelling, curtains, a portrait.',
  bounds: R_MANAGER,
  height: 3.0,
  surfaces: { floor: 'carpet-brown', walls: 'wall-wood', ceiling: 'ceiling-tile' },
  windows: [{ side: 'west', center: 27, width: 2.4, sill: 0.8, top: 2.5 }],
  lights: [
    { id: 'mgr-light-1', position: [-15.5, 3, 27], tone: 'warm', intensity: 0.6, range: 7.5, fixture: 'panel' },
    { id: 'mgr-light-2', position: [-11.5, 3, 27], tone: 'warm', intensity: 0.55, range: 7.5, fixture: 'panel' },
  ],
  props: [
    {
      id: 'mgr-desk',
      type: 'executive-desk',
      position: [-13.5, 0, 28.3],
      rotationY: 180,
      interaction: inspect('Executive desk', 'Executive desk. Polished. One drawer is locked; the others are empty.'),
    },
    {
      id: 'mgr-chair',
      type: 'office-chair',
      variant: 'executive',
      position: [-13.5, 0, 29.4],
      rotationY: 0,
      interaction: inspect('Leather chair', 'Leather chair. Still slightly reclined.'),
    },
    { id: 'mgr-computer', type: 'computer', position: [-12.7, 0.76, 28.45], rotationY: 200, params: { screen: 'memo' } },
    { id: 'mgr-lamp', type: 'desk-lamp', position: [-14.6, 0.76, 28.5], rotationY: 30 },
    {
      id: 'mgr-photo',
      type: 'photo-frame',
      position: [-14.1, 0.76, 27.95],
      rotationY: 10,
      interaction: inspect('Framed photo', 'Framed photo. A family on a beach. Their faces are slightly overexposed.'),
    },
    {
      id: 'mgr-nameplate',
      type: 'nameplate',
      position: [-13.3, 0.76, 27.85],
      rotationY: 0,
      params: { text: 'R. HALDANE - FLOOR MANAGER' },
      interaction: inspect('Nameplate', 'Brass nameplate: "R. HALDANE - FLOOR MANAGER".'),
    },
    {
      id: 'mgr-plant',
      type: 'plant',
      variant: 'ficus',
      position: [-17.25, 0, 30.3],
      interaction: inspect('Potted ficus', 'Potted ficus. In the corner by the window.'),
    },
    wallProp('mgr-bookshelf', 'bookshelf', R_MANAGER, 'east', 27, 0, {
      interaction: inspect('Bookshelf', 'Bookshelf. Binders labelled by year. They skip from 1997 to 2041.'),
    }),
    wallProp('mgr-painting', 'painting', R_MANAGER, 'south', -16, 1.7, {
      variant: 'portrait',
      interaction: inspect('Portrait', 'Portrait. "J. HALDANE, FOUNDER." The eyes are painted closed.'),
    }),
    wallProp('mgr-clock', 'wall-clock', R_MANAGER, 'north', -11, 2.4, {
      interaction: inspect('Wall clock', 'Wall clock. Brass, heavy. Ticking.'),
    }),
    wallProp('mgr-curtains', 'curtains', R_MANAGER, 'west', 27, 0, { params: { width: 2.9 } }, -0.05),
    wallProp('mgr-filing', 'filing-cabinet', R_MANAGER, 'south', -16.8, 0),
    wallProp('mgr-radiator', 'radiator', R_MANAGER, 'west', 24.6, 0, {}, 0.02),
    { id: 'mgr-visitor-1', type: 'waiting-chair', position: [-14.3, 0, 26.75], rotationY: 180 },
    { id: 'mgr-visitor-2', type: 'waiting-chair', position: [-12.7, 0, 26.75], rotationY: 180 },
    { id: 'mgr-trash', type: 'trash-can', position: [-11.8, 0, 29.9] },
  ],
  ambience: { darkness: 0.3, soundscape: ['amb-hum'], floorSound: 'carpet' },
};

/* ----------------------------------------------------------------------------------------- */
/* 7. BREAK ROOM                                                                              */
/* ----------------------------------------------------------------------------------------- */

export const ROOM_BREAK: RoomDefinition = {
  id: 'break-room',
  name: 'Break room',
  description: 'Linoleum, a humming fridge, the only coffee on the floor.',
  bounds: R_BREAK,
  height: 3.0,
  surfaces: { floor: 'linoleum', walls: 'wall-green', ceiling: 'ceiling-tile' },
  windows: [{ side: 'north', center: -2, width: 1.8, sill: 1.0, top: 2.3, blinds: true }],
  lights: [
    { id: 'brk-light-1', position: [-6.5, 3, 27], tone: 'sickly', intensity: 0.65, range: 7.5, fixture: 'panel' },
    { id: 'brk-light-2', position: [-2.5, 3, 27], tone: 'sickly', intensity: 0.6, range: 7.5, fixture: 'panel', flicker: 0.15 },
  ],
  props: [
    wallProp('brk-counter', 'kitchen-counter', R_BREAK, 'north', -6, 0, { params: { length: 4.2 } }),
    {
      id: 'brk-coffee',
      type: 'coffee-machine',
      position: [-7.5, 0.92, 30.45],
      rotationY: 0,
      interaction: {
        kind: 'relief',
        name: 'Coffee machine',
        verb: 'Pour coffee',
        note: 'Coffee machine. It gurgles and pours a cup. The building seems to settle.',
        attentionDelta: -10,
        cooldownSec: 180,
      },
    },
    {
      id: 'brk-microwave',
      type: 'microwave',
      position: [-4.7, 0.92, 30.45],
      rotationY: 0,
      params: { display: '12:00' },
      interaction: inspect('Microwave', 'Microwave. The display blinks 12:00, the way they do after a power cut.'),
    },
    wallProp('brk-fridge', 'fridge', R_BREAK, 'west', 27.5, 0, {
      interaction: inspect('Refrigerator', 'Refrigerator. Inside: forty identical lunches, all labelled "4471".'),
    }),
    {
      id: 'brk-fridge-note',
      type: 'note',
      position: [-8.14, 1.45, 27.3],
      rotationY: 270,
      params: { text: 'PLEASE LABEL|YOUR FOOD' },
      interaction: inspect('Note on fridge', 'Note on the fridge: "PLEASE LABEL YOUR FOOD".'),
    },
    wallProp('brk-vending', 'vending-machine', R_BREAK, 'east', 26.4, 0, {
      interaction: inspect('Vending machine', 'Vending machine. Every slot holds the same thing: a small white card reading THANK YOU.'),
    }),
    {
      id: 'brk-table',
      type: 'dining-table',
      position: [-4.6, 0, 26.6],
      interaction: inspect('Break table', 'Break table. Four chairs. A ring of old coffee.'),
    },
    { id: 'brk-chair-1', type: 'waiting-chair', variant: 'plastic', position: [-5.5, 0, 26.6], rotationY: 270 },
    { id: 'brk-chair-2', type: 'waiting-chair', variant: 'plastic', position: [-3.7, 0, 26.6], rotationY: 90 },
    { id: 'brk-chair-3', type: 'waiting-chair', variant: 'plastic', position: [-4.6, 0, 27.5], rotationY: 0 },
    { id: 'brk-chair-4', type: 'waiting-chair', variant: 'plastic', position: [-4.6, 0, 25.7], rotationY: 180 },
    wallProp('brk-clock', 'wall-clock', R_BREAK, 'south', -7, 2.4, {
      interaction: inspect('Wall clock', 'Wall clock. Plastic. Ticking a little too loudly.'),
    }),
    wallProp('brk-calendar', 'calendar', R_BREAK, 'south', -1.8, 1.6, {
      params: { month: 'NOVEMBER', note: 'POTLUCK FRI' },
    }),
    wallProp('brk-poster', 'poster', R_BREAK, 'east', 29.4, 1.6, {
      variant: 'hygiene',
      interaction: inspect('Poster', 'Poster: "WASH YOUR HANDS. WE ARE COUNTING."'),
    }),
    { id: 'brk-trash', type: 'trash-can', position: [-1.0, 0, 30.3] },
    {
      id: 'brk-duplicate-plant',
      type: 'plant',
      variant: 'red',
      position: [-0.65, 0, 23.75],
      hidden: true,
      interaction: inspect('Potted plant', 'Potted plant. Deep red leaves, glossy as if wet.'),
    },
    {
      id: 'brk-figure',
      type: 'figure',
      position: [-6.3, 0, 27.9],
      rotationY: 120,
      hidden: true,
      cameraOnly: true,
      tracked: false,
    },
  ],
  ambience: { darkness: 0.3, soundscape: ['amb-fridge', 'amb-fluorescent'], floorSound: 'hard' },
};

/* ----------------------------------------------------------------------------------------- */
/* 8. ARCHIVE (dark)                                                                          */
/* ----------------------------------------------------------------------------------------- */

export const ROOM_ARCHIVE: RoomDefinition = {
  id: 'archive',
  name: 'Archive',
  description: 'Shelving in the dark. Bring a light.',
  bounds: R_ARCHIVE,
  height: 3.0,
  surfaces: { floor: 'concrete', walls: 'wall-concrete', ceiling: 'ceiling-concrete' },
  lights: [
    { id: 'arc-light-1', position: [4.2, 3, 26.2], tone: 'sickly', intensity: 0.32, range: 6, fixture: 'strip', flicker: 0.45 },
  ],
  props: [
    { id: 'arc-shelf-1', type: 'archive-shelf', position: [1.35, 0, 27.6], rotationY: 90 },
    {
      id: 'arc-shelf-2',
      type: 'archive-shelf',
      position: [2.85, 0, 27.6],
      rotationY: 270,
      interaction: inspect('Archive shelving', 'Archive shelving. Boxes labelled by year and department.'),
    },
    { id: 'arc-shelf-3', type: 'archive-shelf', position: [5.5, 0, 27.6], rotationY: 90 },
    {
      id: 'arc-box-label',
      type: 'note',
      position: [3.13, 1.25, 26.6],
      rotationY: 270,
      params: { text: 'BOX 1997-03|PERSONNEL' },
      interaction: inspect('Box label', 'A box label: "BOX 1997-03 / PERSONNEL".'),
    },
    {
      id: 'arc-cabinet',
      type: 'filing-cabinet',
      variant: 'restricted',
      position: [0.15, 0, 30.3],
      rotationY: 270,
      interaction: {
        kind: 'hazard',
        name: 'Restricted cabinet',
        verb: 'Force open',
        note: 'Restricted cabinet. You force the drawer. A file for every employee on this floor. One of them is you.',
        attentionDelta: 6,
        cooldownSec: 120,
      },
    },
    // Low stack (0.66 m): the maintenance memo lies on top of it, in the darkest corner.
    { id: 'arc-boxes-1', type: 'boxes', position: [7.25, 0, 30.25], variant: 'low' },
    { id: 'arc-boxes-2', type: 'boxes', position: [0.75, 0, 24.0], variant: 'low' },
    {
      id: 'arc-memo',
      type: 'memo',
      position: [7.2, 0.67, 30.2],
      rotationY: 30,
      interaction: {
        kind: 'pickup',
        name: 'Maintenance memo',
        verb: 'Read',
        flag: 'memo-found',
        note: 'Maintenance memo: "SERVICE ELEVATOR - LOWER LEVELS. Key: Storage, hook 3. Not for use during inspection hours."',
        consumed: true,
      },
    },
    { id: 'arc-desk', type: 'desk', position: [6.9, 0, 24.0], rotationY: 0 },
    {
      id: 'arc-microfiche',
      type: 'computer',
      variant: 'microfiche',
      position: [6.9, 0.75, 24.15],
      rotationY: 0,
      params: { screen: 'microfiche' },
      interaction: inspect('Microfiche reader', 'Microfiche reader. The last slide shows a floor plan of this floor, dated tomorrow.'),
    },
    wallProp('arc-calendar', 'calendar', R_ARCHIVE, 'south', 1.6, 1.6, {
      params: { month: 'NOVEMBER', note: '' },
      interaction: inspect('Calendar', 'Calendar. November. Nothing written on it.'),
    }),
    {
      id: 'arc-extra-door',
      type: 'fake-door',
      variant: 'sealed',
      position: [7.86, 0, 26.6],
      rotationY: 90,
      hidden: true,
      interaction: inspect('Door', 'A door.'),
    },
  ],
  ambience: { darkness: 0.8, soundscape: ['amb-room-tone'], floorSound: 'hard' },
  tags: ['dark'],
};

/* ----------------------------------------------------------------------------------------- */
/* 9. STORAGE ROOM                                                                            */
/* ----------------------------------------------------------------------------------------- */

export const ROOM_STORAGE: RoomDefinition = {
  id: 'storage',
  name: 'Storage room',
  description: 'Steel shelving, a mop bucket, a janitor\'s closet that is always locked.',
  bounds: R_STORAGE,
  extraBounds: [STORAGE_CLOSET],
  height: 2.9,
  surfaces: { floor: 'concrete', walls: 'wall-concrete', ceiling: 'ceiling-concrete' },
  openings: [{ side: 'north', center: 11.5, width: 1.0, height: 2.1 }],
  lights: [
    { id: 'stg-light-1', position: [11, 2.9, 26.5], tone: 'warm', intensity: 0.42, range: 6.5, fixture: 'bulb', flicker: 0.18 },
  ],
  props: [
    wallProp('stg-shelf-1', 'metal-shelf', R_STORAGE, 'east', 27, 0, {
      params: { length: 3 },
      interaction: inspect('Steel shelving', 'Steel shelving. Toner, paper, a box of identical keyboards.'),
    }),
    wallProp('stg-shelf-2', 'metal-shelf', R_STORAGE, 'west', 27.8, 0, { params: { length: 2.4 } }),
    { id: 'stg-boxes-1', type: 'boxes', position: [12.9, 0, 24.1], variant: 'stack' },
    { id: 'stg-boxes-2', type: 'boxes', position: [9.1, 0, 30.2], variant: 'low' },
    {
      id: 'stg-mop',
      type: 'mop-bucket',
      position: [9.0, 0, 24.2],
      interaction: inspect('Mop bucket', 'Mop bucket. The water is grey and perfectly still.'),
    },
    { id: 'stg-ladder', type: 'ladder', position: [13.3, 0, 30.5], rotationY: 10 },
    wallProp('stg-breaker', 'breaker-panel', R_STORAGE, 'west', 25.2, 1.4, {
      interaction: inspect('Breaker panel', 'Breaker panel. Every switch labelled FLOOR 14. One is labelled YOU. It is ON.'),
    }),
    wallProp('stg-key-hook', 'key-hook', R_STORAGE, 'north', 9.6, 1.45, {
      interaction: {
        kind: 'pickup',
        name: 'Service key',
        verb: 'Take',
        flag: 'service-key',
        note: 'A brass key on hook 3, tagged "S-3 / LOWER LEVELS".',
        attentionDelta: 3,
        consumed: true,
      },
    }),
    {
      id: 'stg-closet-door',
      type: 'fake-door',
      variant: 'closet',
      position: [11.5, 0, 31],
      rotationY: 0,
      params: { label: 'JANITOR' },
      interaction: inspect("Janitor's closet", "Janitor's closet. Locked."),
    },
    {
      id: 'stg-closet-vignette',
      type: 'closet-vignette',
      position: [11.5, 0, 31],
      rotationY: 0,
      hidden: true,
      tracked: false,
    },
    { id: 'stg-chair-stack', type: 'waiting-chair', variant: 'plastic', position: [12.6, 0, 28.9], rotationY: 200 },
  ],
  ambience: { darkness: 0.6, soundscape: ['amb-room-tone', 'amb-hum'], floorSound: 'hard' },
  tags: ['dark'],
};

/* ----------------------------------------------------------------------------------------- */
/* 10. SECURITY ROOM                                                                          */
/* ----------------------------------------------------------------------------------------- */

export const ROOM_SECURITY: RoomDefinition = {
  id: 'security',
  name: 'Security room',
  description: 'Four camera feeds. They do not always agree with you.',
  bounds: R_SECURITY,
  height: 3.0,
  surfaces: { floor: 'carpet-gray', walls: 'wall-blue', ceiling: 'ceiling-tile' },
  lights: [
    { id: 'sec-light-1', position: [17, 3, 17], tone: 'cool', intensity: 0.5, range: 7.5, fixture: 'panel' },
    { id: 'sec-light-2', position: [17, 3, 23], tone: 'cool', intensity: 0.45, range: 7.5, fixture: 'panel' },
  ],
  props: [
    {
      id: 'sec-desk',
      type: 'security-desk',
      position: [19.15, 0, 20],
      rotationY: 90,
      interaction: { kind: 'security-console', name: 'Security monitors', verb: 'Watch' },
    },
    { id: 'sec-chair', type: 'office-chair', position: [17.9, 0, 20], rotationY: 270 },
    {
      id: 'sec-logbook',
      type: 'logbook',
      position: [18.8, 0.76, 21.2],
      rotationY: 75,
      interaction: inspect('Night shift log', 'Night shift log. Last entry: "03:12 - All quiet. Elevator B still out of service."'),
    },
    { id: 'sec-mug', type: 'mug', position: [18.8, 0.76, 18.8] },
    {
      id: 'sec-rack',
      type: 'server-rack',
      position: [19.5, 0, 15],
      rotationY: 90,
      interaction: inspect('Server rack', 'Server rack. Every light blinks in unison, like breathing.'),
    },
    wallProp('sec-poster', 'poster', R_SECURITY, 'west', 16.2, 1.6, { variant: 'cctv' }),
    wallProp('sec-map', 'wall-map', R_SECURITY, 'west', 24.4, 1.55),
    { id: 'sec-trash', type: 'trash-can', position: [14.7, 0, 25.4] },
  ],
  ambience: { darkness: 0.35, soundscape: ['amb-electronics', 'amb-hum'], floorSound: 'carpet' },
};

export const FLOOR_14_ROOMS: readonly RoomDefinition[] = [
  ROOM_RECEPTION,
  ROOM_LOBBY,
  ROOM_OPEN_PLAN,
  ROOM_CONFERENCE,
  ROOM_CORRIDOR,
  ROOM_MANAGER,
  ROOM_BREAK,
  ROOM_ARCHIVE,
  ROOM_STORAGE,
  ROOM_SECURITY,
];
