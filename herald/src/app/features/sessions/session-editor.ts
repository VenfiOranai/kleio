import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { Session } from '@/core/api/models';
import { SessionService } from '@/core/api/session.service';
import { MarkdownView } from '@/shared/markdown-view/markdown-view';

@Component({
  selector: 'app-session-editor',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    ZardButtonComponent,
    ZardInputDirective,
    MarkdownView,
  ],
  templateUrl: './session-editor.html',
})
export class SessionEditor {
  private readonly router = inject(Router);
  private readonly service = inject(SessionService);
  private readonly fb = inject(FormBuilder);

  // Bound from route params when routed, or passed directly when embedded in the workspace.
  readonly sessionId = input.required({ transform: numberAttribute });
  readonly campaignId = input.required({ transform: numberAttribute });
  /** Hide the page chrome (back link) when embedded in the workspace. */
  readonly embedded = input(false);

  protected readonly session = signal<Session | null>(null);
  protected readonly saved = signal(false);
  protected readonly summarizing = signal(false);
  protected readonly summarizeError = signal<string | null>(null);
  /** Active pane when embedded in the workspace (space is tight, so we tab instead of stack). */
  protected readonly tab = signal<'write' | 'preview' | 'summary'>('write');

  protected readonly form = this.fb.nonNullable.group({
    title: [''],
    session_date: [''],
    raw_notes: [''],
    summary: [''],
  });

  /** Live-updating sources for the markdown previews. */
  protected readonly rawNotes = toSignal(this.form.controls.raw_notes.valueChanges, {
    initialValue: '',
  });
  protected readonly summary = toSignal(this.form.controls.summary.valueChanges, {
    initialValue: '',
  });

  constructor() {
    // Reload whenever the selected session changes (e.g. switching sessions in the workspace).
    effect(() => {
      const id = this.sessionId();
      this.service.get(id).subscribe((s) => {
        this.session.set(s);
        this.form.patchValue({
          title: s.title,
          session_date: s.session_date ?? '',
          raw_notes: s.raw_notes,
          summary: s.summary ?? '',
        });
      });
    });
  }

  private payload(): Partial<Session> {
    const value = this.form.getRawValue();
    return {
      title: value.title,
      session_date: value.session_date || null,
      raw_notes: value.raw_notes,
      summary: value.summary || null,
    };
  }

  private applySaved(s: Session): void {
    this.session.set(s);
    this.form.patchValue({ summary: s.summary ?? '' });
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2000);
  }

  protected save(): void {
    this.service.update(this.sessionId(), this.payload()).subscribe((s) => this.applySaved(s));
  }

  /** Persist current edits, then ask the server to summarize the saved notes. */
  protected summarize(): void {
    this.summarizing.set(true);
    this.summarizeError.set(null);
    this.service
      .update(this.sessionId(), this.payload())
      .pipe(switchMap(() => this.service.summarize(this.sessionId())))
      .subscribe({
        next: (s) => {
          this.summarizing.set(false);
          this.applySaved(s);
        },
        error: (err: HttpErrorResponse) => {
          this.summarizing.set(false);
          this.summarizeError.set(err.error?.detail ?? 'Summarization failed. Please try again.');
        },
      });
  }

  protected remove(): void {
    this.service
      .delete(this.sessionId())
      .subscribe(() => this.router.navigate(['/campaigns', this.campaignId()]));
  }
}
