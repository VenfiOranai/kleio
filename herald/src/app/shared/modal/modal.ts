import { Component, ElementRef, ViewEncapsulation, input, output, viewChild } from '@angular/core';

/**
 * A lightweight modal built on the native `<dialog>` element — focus trapping, Esc-to-close,
 * and a backdrop come for free, so it needs no CDK Overlay (which the project reserves for
 * layout/BreakpointObserver only). Project content via `<ng-content>`; drive it with
 * `open()` / `close()` from the host, or listen to `(closed)`.
 */
@Component({
  selector: 'app-modal',
  templateUrl: './modal.html',
  styleUrl: './modal.css',
  encapsulation: ViewEncapsulation.None,
})
export class Modal {
  readonly title = input('');
  /** Emitted whenever the dialog closes (backdrop, Esc, or close button). */
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  /** Clicking the backdrop registers as a click on the dialog element itself. */
  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  protected onClose(): void {
    this.closed.emit();
  }
}
