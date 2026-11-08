import { DestroyRef, afterNextRender, inject } from '@angular/core';

export interface WindowListenerOptions {
  /**
   * Listen in the capture phase. Overlays use this for the keys they own (Escape, Tab...) so they
   * run before any bubble-phase game input listener and can stop the event from reaching it.
   */
  readonly capture?: boolean;
}

/**
 * Registers a `window` listener once the owning component has rendered in the browser and removes
 * it when the component is destroyed. Must be called in an injection context (constructor / field).
 * Never runs on the server.
 */
export function listenOnWindow<K extends keyof WindowEventMap>(
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  options: WindowListenerOptions = {},
): void {
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    const capture = options.capture ?? false;
    const listener = (event: WindowEventMap[K]): void => handler(event);
    window.addEventListener(type, listener, { capture });
    destroyRef.onDestroy(() => window.removeEventListener(type, listener, { capture }));
  });
}

/** Same as {@link listenOnWindow} for `document` events (visibilitychange, fullscreenchange...). */
export function listenOnDocument<K extends keyof DocumentEventMap>(
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options: WindowListenerOptions = {},
): void {
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    const capture = options.capture ?? false;
    const listener = (event: DocumentEventMap[K]): void => handler(event);
    document.addEventListener(type, listener, { capture });
    destroyRef.onDestroy(() => document.removeEventListener(type, listener, { capture }));
  });
}

/** Consume a keyboard event completely (no default action, no other listeners). */
export function consumeKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}
