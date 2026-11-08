/**
 * Keyboard / mouse / pointer-lock handling. Listeners are attached once and removed on dispose
 * (no duplicate handlers across restarts). Uses `event.code` so WASD works on any layout.
 */
export class InputManager {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private intentionalRelease = false;
  private locked = false;
  enabled = false;

  /** Called with (locked, wasIntentional). */
  onLockChange: (locked: boolean, intentional: boolean) => void = () => undefined;
  /** Raw key press callback (fires even when movement is disabled). */
  onKey: (code: string) => void = () => undefined;

  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.listen(document, 'keydown', (e) => this.keyDown(e as KeyboardEvent));
    this.listen(document, 'keyup', (e) => this.down.delete((e as KeyboardEvent).code));
    this.listen(document, 'mousemove', (e) => this.mouseMove(e as MouseEvent));
    this.listen(document, 'pointerlockchange', () => this.lockChanged());
    this.listen(document, 'pointerlockerror', () => this.lockChanged());
    this.listen(window, 'blur', () => this.down.clear());
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  private listen(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.listeners.push([target, type, handler, options]);
  }

  private keyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (this.locked && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
    if (!e.repeat) {
      this.pressed.add(e.code);
      if (this.locked) this.onKey(e.code);
    }
    this.down.add(e.code);
  }

  private mouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    // Clamp spikes some browsers produce right after locking.
    this.mouseDX += Math.max(-250, Math.min(250, e.movementX));
    this.mouseDY += Math.max(-250, Math.min(250, e.movementY));
  }

  private lockChanged(): void {
    const locked = document.pointerLockElement === this.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    const intentional = this.intentionalRelease;
    this.intentionalRelease = false;
    if (!locked) this.down.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.onLockChange(locked, intentional);
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => this.onLockChange(false, true));
    } catch {
      this.onLockChange(false, true);
    }
  }

  releaseLock(): void {
    if (!this.locked) return;
    this.intentionalRelease = true;
    document.exitPointerLock();
  }

  get isLocked(): boolean {
    return this.locked || this.simulatedLock;
  }

  /* ---- development-only automation hooks (used by window.__tfil in dev builds) ---- */
  private simulatedLock = false;

  simulateLock(on: boolean): void {
    this.simulatedLock = on;
  }

  simulatePress(code: string): void {
    this.pressed.add(code);
    this.onKey(code);
  }

  simulateHold(code: string, ms: number): void {
    this.down.add(code);
    setTimeout(() => this.down.delete(code), ms);
  }

  simulateMouse(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  /** Edge-triggered press since the last `endFrame()`. */
  wasPressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  takeMouse(): { dx: number; dy: number } {
    const d = { dx: this.enabled ? this.mouseDX : 0, dy: this.enabled ? this.mouseDY : 0 };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    for (const [target, type, handler, options] of this.listeners) target.removeEventListener(type, handler, options);
    this.listeners.length = 0;
    if (this.locked) {
      this.intentionalRelease = true;
      document.exitPointerLock();
    }
  }
}
