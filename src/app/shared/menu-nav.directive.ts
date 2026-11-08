import { Directive, ElementRef, booleanAttribute, inject, input } from '@angular/core';
import { UiSoundService } from './ui-sound.service';

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
const PREFERRED =
  '[aria-pressed="true"]:not(:disabled), [aria-checked="true"]:not(:disabled), input:checked:not(:disabled)';

/**
 * Game-menu keyboard navigation for a list of rows.
 *
 * Mark each row with `data-nav-row`. ArrowUp / ArrowDown move focus between rows (wrapping),
 * ArrowLeft / ArrowRight move between buttons inside a multi-button row (segmented controls,
 * action rows). Range inputs keep their native Left/Right behaviour. Enter / Space activate the
 * focused button natively. Hovering an item focuses it so mouse and keyboard share one highlight.
 * Do not nest two `appMenuNav` hosts.
 */
@Directive({
  selector: '[appMenuNav]',
  host: {
    '(keydown)': 'onKeydown($event)',
    '(mouseover)': 'onMouseOver($event)',
    '(focusin)': 'onFocusIn($event)',
  },
})
export class MenuNavDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sound = inject(UiSoundService);

  /** Focus items on hover (default true). */
  readonly hoverFocus = input(true, { alias: 'appMenuNavHover', transform: booleanAttribute });
  /** Play the hover tick when focus moves between items (default true). */
  readonly sounds = input(true, { alias: 'appMenuNavSounds', transform: booleanAttribute });

  private lastFocused: Element | null = null;

  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (this.moveRow(event.key === 'ArrowDown' ? 1 : -1)) {
          event.preventDefault();
          event.stopPropagation();
        }
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (this.moveWithinRow(event.key === 'ArrowRight' ? 1 : -1)) {
          event.preventDefault();
          event.stopPropagation();
        }
        break;
      case 'Home':
      case 'End': {
        const rows = this.rows();
        const row = event.key === 'Home' ? rows[0] : rows[rows.length - 1];
        if (row) {
          this.focusRow(row);
          event.preventDefault();
        }
        break;
      }
      default:
        break;
    }
  }

  protected onMouseOver(event: MouseEvent): void {
    if (!this.hoverFocus()) return;
    const target = event.target instanceof Element ? event.target.closest(FOCUSABLE) : null;
    if (!(target instanceof HTMLElement) || target === document.activeElement) return;
    if (!target.closest('[data-nav-row]') || !this.host.nativeElement.contains(target)) return;
    // Don't steal focus from a slider that is being dragged.
    if (event.buttons !== 0) return;
    target.focus({ preventScroll: true });
  }

  protected onFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-nav-row]')) return;
    if (this.lastFocused !== null && this.lastFocused !== target && this.sounds()) this.sound.hover();
    this.lastFocused = target;
  }

  private rows(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-nav-row]')).filter(
      (row) => row.querySelector(FOCUSABLE) !== null && row.offsetParent !== null,
    );
  }

  private focusRow(row: HTMLElement): void {
    const target = row.querySelector<HTMLElement>(PREFERRED) ?? row.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus({ preventScroll: false });
  }

  private moveRow(direction: 1 | -1): boolean {
    const rows = this.rows();
    if (!rows.length) return false;
    const active = document.activeElement;
    const current = rows.findIndex((row) => active instanceof Node && row.contains(active));
    const next = current === -1 ? (direction === 1 ? 0 : rows.length - 1) : (current + direction + rows.length) % rows.length;
    this.focusRow(rows[next]);
    return true;
  }

  private moveWithinRow(direction: 1 | -1): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement)) return false;
    const row = active.closest<HTMLElement>('[data-nav-row]');
    if (!row || !this.host.nativeElement.contains(row)) return false;
    const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (buttons.length < 2) return false;
    const index = buttons.indexOf(active);
    buttons[(index + direction + buttons.length) % buttons.length].focus();
    return true;
  }
}
