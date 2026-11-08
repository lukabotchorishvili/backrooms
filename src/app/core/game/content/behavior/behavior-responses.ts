import { BehaviorResponseDefinition } from '../../models';

/**
 * How the building adapts to each tendency. Responses never block progress: they only
 * re-weight which anomalies/decoys are chosen and add flavour messages.
 */
export const BEHAVIOR_RESPONSES: readonly BehaviorResponseDefinition[] = [
  {
    id: 'doors-noticed',
    tendency: 'door-checker',
    threshold: 0.5,
    description: 'Frequent door checking: door-related anomalies and misleading door signs.',
    tagWeightMultipliers: { door: 2.6 },
    messages: [
      'YOU HAVE OPENED {doorCount} DOORS. NONE OF THEM WERE THE EXIT.',
      'THE DOORS HAVE NOTICED YOU, {employee}.',
    ],
  },
  {
    id: 'dark-invitation',
    tendency: 'avoidant',
    threshold: 0.55,
    description: 'Avoids dark areas: clues migrate into darker rooms, sounds come from the dark.',
    tagWeightMultipliers: { dark: 2.4 },
    decoyTagMultipliers: { dark: 2.5 },
    messages: [
      'THE ARCHIVE IS NOT DANGEROUS, {employee}.',
      'WHY DO YOU STAY IN THE LIGHT?',
    ],
  },
  {
    id: 'familiar-rooms',
    tendency: 'repetitive',
    threshold: 0.5,
    description: 'Revisits the same rooms: those rooms start to change between visits.',
    tagWeightMultipliers: { revisit: 2.4 },
    messages: [
      'YOU KEEP RETURNING TO THE {mostVisitedRoom}.',
      'FAMILIAR ROOMS ARE THE EASIEST TO CHANGE.',
    ],
  },
  {
    id: 'slow-down',
    tendency: 'rusher',
    threshold: 0.5,
    description: 'Rushes: clues that only reveal themselves when standing still, misleading signs.',
    tagWeightMultipliers: { 'slow-down': 2.8, misleading: 1.8 },
    messages: ['SLOW DOWN. YOU ARE MISSING THINGS.', 'RUNNING IS NOT PERMITTED ON THIS FLOOR.'],
  },
  {
    id: 'decoys-for-the-curious',
    tendency: 'curious',
    threshold: 0.55,
    description: 'Inspects everything: more decoys, more changes that happen after leaving.',
    tagWeightMultipliers: { unobserved: 1.9 },
    decoyRateMultiplier: 1.7,
    messages: [
      'NOT EVERYTHING YOU TOUCH IS WRONG, {employee}.',
      'YOU HAVE INSPECTED {inspections} OBJECTS TODAY.',
    ],
  },
  {
    id: 'behind-you',
    tendency: 'cautious',
    threshold: 0.55,
    description: 'Moves slowly and checks surroundings: audio events behind the player.',
    tagWeightMultipliers: { audio: 1.6, 'slow-down': 1.4 },
    messages: ['YOU LOOK BEHIND YOU A LOT.', 'CAUTION IS APPRECIATED.'],
  },
  {
    id: 'subtle-for-observant',
    tendency: 'observant',
    threshold: 0.6,
    description: 'Consistently correct: subtler anomalies are favoured.',
    tagWeightMultipliers: { subtle: 1.8 },
    messages: ['YOU ARE GOOD AT THIS. THAT IS WHY YOU WERE HIRED.'],
  },
];
