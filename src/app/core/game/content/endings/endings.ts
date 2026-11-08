import { EndingDefinition } from '../../models';

export const ENDING_NORMAL_EXIT: EndingDefinition = {
  id: 'normal-exit',
  code: 'A',
  title: 'NORMAL EXIT',
  trigger: 'elevator-standard',
  priority: 0,
  conditions: [{ type: 'investigation-complete' }],
  sequence: {
    interior: 'standard',
    destination: 'none',
    closeDelaySec: 2.5,
    rideSec: 7,
    indicatorSequence: ['14', '13', '12', '11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'G'],
    shake: 0.25,
    lightsFlicker: false,
    revealSec: 0,
    fadeSec: 3,
    rideSound: 'elevator-motor',
    arrivalSound: 'elevator-ding',
  },
  epilogue: {
    lines: ['THANK YOU FOR COMPLETING YOUR SHIFT.'],
    caption: 'The doors closed. The numbers went down. Nothing followed you.',
  },
};

export const ENDING_BUILDING_REMEMBERS: EndingDefinition = {
  id: 'building-remembers',
  code: 'B',
  title: 'THE BUILDING REMEMBERS',
  trigger: 'elevator-standard',
  priority: 10,
  conditions: [
    { type: 'investigation-complete' },
    {
      type: 'any',
      conditions: [
        { type: 'attention-at-least', value: 55 },
        { type: 'escalations-at-least', value: 1 },
      ],
    },
  ],
  sequence: {
    interior: 'reception-replica',
    destination: 'none',
    closeDelaySec: 3,
    rideSec: 6,
    indicatorSequence: ['14', '14', '14', '14', '14', '14'],
    shake: 0.1,
    lightsFlicker: true,
    revealSec: 0,
    fadeSec: 4,
    rideSound: 'room-tone',
    arrivalSound: 'pa-chime',
  },
  epilogue: {
    lines: [
      'EMPLOYEE STATUS: ACTIVE',
      'SHIFT: 09:00–17:00',
      'THE BUILDING REMEMBERS YOU.',
      'PLEASE REPORT TO RECEPTION.',
    ],
    caption: 'The elevator never moved. It did not need to.',
  },
};

export const ENDING_WRONG_EXIT: EndingDefinition = {
  id: 'wrong-exit',
  code: 'C',
  title: 'THE WRONG EXIT',
  trigger: 'elevator-service',
  priority: 20,
  conditions: [
    { type: 'investigation-complete' },
    { type: 'flag', flag: 'memo-found' },
    { type: 'flag', flag: 'service-key' },
  ],
  sequence: {
    interior: 'standard',
    destination: 'infinite-floor',
    closeDelaySec: 1.5,
    rideSec: 11,
    indicatorSequence: ['14', '9', '4', '1', 'B', '-1', '-4', '-11', '-27', '-58', '-∞'],
    shake: 0.45,
    lightsFlicker: true,
    revealSec: 14,
    fadeSec: 5,
    rideSound: 'elevator-motor',
    arrivalSound: 'elevator-ding',
  },
  epilogue: {
    lines: [
      'FLOOR −∞',
      'YOUR NEXT INSPECTION HAS BEEN SCHEDULED.',
      'THE BUILDING IS LARGER THAN YOU WERE TOLD.',
    ],
    caption: 'The service elevator only goes down.',
  },
};

export const ENDINGS: readonly EndingDefinition[] = [
  ENDING_NORMAL_EXIT,
  ENDING_BUILDING_REMEMBERS,
  ENDING_WRONG_EXIT,
];
