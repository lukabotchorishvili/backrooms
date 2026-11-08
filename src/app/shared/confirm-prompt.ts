import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AutofocusDirective } from './autofocus.directive';
import { MenuNavDirective } from './menu-nav.directive';

let nextId = 0;

/** Inline "are you sure" block. Cancel is focused by default; Escape is handled by the parent. */
@Component({
  selector: 'app-confirm-prompt',
  imports: [AutofocusDirective, MenuNavDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'confirm' },
  template: `
    <div role="alertdialog" [attr.aria-labelledby]="id + '-t'" [attr.aria-describedby]="id + '-m'">
      <p class="confirm__title" [id]="id + '-t'">{{ heading() }}</p>
      <p class="confirm__message" [id]="id + '-m'">{{ message() }}</p>
      <div class="confirm__actions" appMenuNav>
        <div class="btn-row" data-nav-row>
          <button type="button" class="btn btn--danger" (click)="confirmed.emit()">{{ confirmLabel() }}</button>
          <button type="button" class="btn" appAutofocus (click)="cancelled.emit()">{{ cancelLabel() }}</button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmPrompt {
  readonly heading = input.required<string>();
  readonly message = input('');
  readonly confirmLabel = input('CONFIRM');
  readonly cancelLabel = input('CANCEL');
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  protected readonly id = `confirm-${++nextId}`;
}
