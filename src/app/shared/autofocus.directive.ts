import { Directive, ElementRef, afterNextRender, booleanAttribute, inject, input } from '@angular/core';

/** Focuses its host once after it first renders (when the bound value is true). */
@Directive({ selector: '[appAutofocus]' })
export class AutofocusDirective {
  readonly appAutofocus = input(true, { transform: booleanAttribute });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => {
      if (this.appAutofocus()) host.nativeElement.focus({ preventScroll: true });
    });
  }
}
