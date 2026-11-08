/** True when the user asked the OS/browser for reduced motion. Safe to call on the server. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Keys that never count as "any key" (skip prompts etc.). */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'Fn',
  'OS',
  'F11',
  'F12',
]);
