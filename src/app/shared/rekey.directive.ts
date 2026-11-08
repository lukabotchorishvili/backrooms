import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';

interface RekeyContext<T> {
  $implicit: T;
  appRekey: T;
}

/**
 * Re-creates its content whenever the key changes, so `animate.enter` replays
 * (objective changes, new inspection cards, note pulses...).
 *
 *   <ng-container *appRekey="session.objectiveText(); let objective"> ... </ng-container>
 */
@Directive({ selector: '[appRekey]' })
export class RekeyDirective<T> {
  readonly appRekey = input.required<T>();
  private readonly template = inject<TemplateRef<RekeyContext<T>>>(TemplateRef);
  private readonly container = inject(ViewContainerRef);

  constructor() {
    effect(() => {
      const key = this.appRekey();
      this.container.clear();
      this.container.createEmbeddedView(this.template, { $implicit: key, appRekey: key });
    });
  }

  static ngTemplateContextGuard<T>(_dir: RekeyDirective<T>, ctx: unknown): ctx is RekeyContext<T> {
    return true;
  }
}
