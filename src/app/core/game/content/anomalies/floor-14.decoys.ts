import { DecoyDefinition } from '../../models';

/**
 * Normal building behaviour that *feels* suspicious. Decoys log notebook entries when heard,
 * but reporting them is a false report. Rate is set by difficulty and behaviour responses.
 */
export const FLOOR_14_DECOYS: readonly DecoyDefinition[] = [
  {
    id: 'dec-vent-rattle',
    roomId: 'open-plan',
    subject: 'Ventilation',
    observation: 'The ventilation rattled hard, then settled.',
    effects: [{ type: 'sound', soundId: 'vent-rattle', position: [-9, 2.9, 15], radius: 16 }],
  },
  {
    id: 'dec-pipes',
    roomId: 'break-room',
    subject: 'Pipes',
    observation: 'Water pipes knocked inside the break room wall.',
    effects: [{ type: 'sound', soundId: 'pipes', position: [-8.6, 1.4, 29.5], radius: 14 }],
  },
  {
    id: 'dec-tube-buzz',
    roomId: 'employee-corridor',
    subject: 'Corridor light',
    observation: 'A corridor light buzzed loudly and stuttered once.',
    durationSec: 1.4,
    effects: [
      { type: 'sound', soundId: 'fluorescent-zap', position: [-5.5, 2.9, 21.5], radius: 14 },
      { type: 'light-pattern', roomId: 'employee-corridor', lightIds: ['cor-light-2'], pattern: '0101101', stepSec: 0.12 },
    ],
  },
  {
    id: 'dec-monitor-standby',
    roomId: 'open-plan',
    subject: 'Monitor',
    observation: 'A monitor in the open office clicked and switched to standby.',
    durationSec: 70,
    effects: [
      { type: 'set-text', propId: 'opn-monitor-10', text: 'NO SIGNAL|STANDBY' },
      { type: 'sound', soundId: 'monitor-click', position: [-13.5, 1, 16.4], radius: 10 },
    ],
  },
  {
    id: 'dec-elevator-machinery',
    roomId: 'elevator-lobby',
    subject: 'Elevator machinery',
    observation: 'Elevator machinery hummed somewhere behind the lobby wall, then stopped.',
    effects: [{ type: 'sound', soundId: 'elevator-machinery', position: [15.5, 2, 5], radius: 18 }],
  },
  {
    id: 'dec-printer',
    roomId: 'open-plan',
    subject: 'Photocopier',
    observation: 'The photocopier whirred, warming up, then went quiet.',
    effects: [{ type: 'sound', soundId: 'printer', position: [-3.2, 1, 19.4], radius: 13 }],
  },
  {
    id: 'dec-cooler',
    roomId: 'open-plan',
    subject: 'Water cooler',
    observation: 'The water cooler gurgled.',
    effects: [{ type: 'sound', soundId: 'cooler-gurgle', position: [-1.7, 1, 19.55], radius: 9 }],
  },
  {
    id: 'dec-pa-routine',
    roomId: 'reception',
    subject: 'PA announcement',
    observation: 'PA announcement: "Reminder: the break room refrigerator will be cleaned on Friday."',
    weight: 0.6,
    effects: [
      {
        type: 'announcement',
        text: 'Reminder. The break room refrigerator will be cleaned on Friday. Thank you.',
        position: [5.8, 3, 1.2],
      },
    ],
  },
  {
    id: 'dec-archive-settle',
    roomId: 'archive',
    subject: 'Archive shelves',
    observation: 'Something shifted on an archive shelf. Paper settling.',
    tags: ['dark'],
    effects: [{ type: 'sound', soundId: 'paper-settle', position: [3, 1.6, 28.5], radius: 11 }],
  },
  {
    id: 'dec-storage-drip',
    roomId: 'storage',
    subject: 'Dripping',
    observation: 'Water dripping somewhere in the storage room.',
    tags: ['dark'],
    effects: [{ type: 'sound', soundId: 'drip', position: [9, 0.4, 24.2], radius: 10 }],
  },
  {
    id: 'dec-radiator-tick',
    roomId: 'manager-office',
    subject: 'Radiator',
    observation: "The radiator in the manager's office ticked as it cooled.",
    effects: [{ type: 'sound', soundId: 'radiator-tick', position: [-17.6, 0.5, 24.6], radius: 10 }],
  },
];

export const FLOOR_14_DECOY_IDS: readonly string[] = FLOOR_14_DECOYS.map((d) => d.id);
