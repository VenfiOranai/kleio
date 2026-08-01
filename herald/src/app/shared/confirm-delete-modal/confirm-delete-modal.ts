import { Component, computed, input, output, signal, viewChild } from '@angular/core';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { Modal } from '@/shared/modal/modal';

/**
 * Confirmation modal for destructive deletes. The confirm button stays disabled until the user
 * types the target's name (case-insensitive, trimmed) into the text field, guarding against
 * accidental deletion. Drive it with `open()`; listen to `(confirmed)` to perform the delete.
 */
@Component({
  selector: 'app-confirm-delete-modal',
  imports: [Modal, ZardButtonComponent, ZardInputDirective],
  templateUrl: './confirm-delete-modal.html',
})
export class ConfirmDeleteModal {
  /** The exact name the user must type to enable the confirm button. */
  readonly name = input('');
  /** Noun for the message, e.g. "session" or "character". */
  readonly itemLabel = input('item');
  /** Emitted once the user confirms with a matching name. */
  readonly confirmed = output<void>();

  private readonly modal = viewChild.required(Modal);

  protected readonly typed = signal('');

  protected readonly matches = computed(
    () => this.typed().trim().toLowerCase() === this.name().trim().toLowerCase(),
  );

  open(): void {
    this.typed.set('');
    this.modal().open();
  }

  protected confirm(): void {
    if (!this.matches()) return;
    this.modal().close();
    this.confirmed.emit();
  }

  protected cancel(): void {
    this.modal().close();
  }
}
