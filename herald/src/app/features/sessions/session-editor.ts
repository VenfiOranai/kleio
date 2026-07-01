import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { Session } from '@/core/api/models';
import { SessionService } from '@/core/api/session.service';
import { MarkdownView } from '@/shared/markdown-view/markdown-view';

@Component({
  selector: 'app-session-editor',
  imports: [ReactiveFormsModule, RouterLink, ZardButtonComponent, ZardInputDirective, MarkdownView],
  templateUrl: './session-editor.html',
})
export class SessionEditor {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(SessionService);
  private readonly fb = inject(FormBuilder);

  private readonly sessionId = Number(this.route.snapshot.paramMap.get('sessionId'));
  protected readonly campaignId = Number(this.route.snapshot.paramMap.get('campaignId'));
  protected readonly session = signal<Session | null>(null);
  protected readonly saved = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    title: [''],
    session_date: [''],
    raw_notes: [''],
    summary: [''],
  });

  /** Live-updating source for the markdown preview. */
  protected readonly rawNotes = toSignal(this.form.controls.raw_notes.valueChanges, {
    initialValue: '',
  });

  constructor() {
    this.service.get(this.sessionId).subscribe((s) => {
      this.session.set(s);
      this.form.patchValue({
        title: s.title,
        session_date: s.session_date ?? '',
        raw_notes: s.raw_notes,
        summary: s.summary ?? '',
      });
    });
  }

  protected save(): void {
    const value = this.form.getRawValue();
    this.service
      .update(this.sessionId, {
        title: value.title,
        session_date: value.session_date || null,
        raw_notes: value.raw_notes,
        summary: value.summary || null,
      })
      .subscribe((s) => {
        this.session.set(s);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 2000);
      });
  }

  protected remove(): void {
    this.service
      .delete(this.sessionId)
      .subscribe(() => this.router.navigate(['/campaigns', this.campaignId]));
  }
}
