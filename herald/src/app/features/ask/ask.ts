import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, numberAttribute, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { AskResponse } from '@/core/api/models';
import { QaService } from '@/core/api/qa.service';
import { MarkdownView } from '@/shared/markdown-view/markdown-view';

@Component({
  selector: 'app-ask',
  imports: [ReactiveFormsModule, RouterLink, ZardButtonComponent, ZardInputDirective, MarkdownView],
  templateUrl: './ask.html',
})
export class Ask {
  private readonly service = inject(QaService);
  private readonly fb = inject(FormBuilder);

  /** Bound from the route param (route mode) or passed in when embedded in the editor tabs. */
  readonly campaignId = input.required({ transform: numberAttribute });
  /** Hide the page chrome (back link + heading) when embedded as a workspace tab. */
  readonly embedded = input(false);

  protected readonly form = this.fb.nonNullable.group({
    question: ['', Validators.required],
  });
  /** The last submitted question, shown in the output block (cleared from the input on submit). */
  protected readonly submitted = signal<string | null>(null);
  protected readonly answer = signal<AskResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected ask(): void {
    const question = this.form.controls.question.value.trim();
    if (!question || this.loading()) return;
    // Move the question into the output block and clear the input, ready for the next one.
    this.submitted.set(question);
    this.form.reset({ question: '' });
    this.answer.set(null);
    this.error.set(null);
    this.loading.set(true);
    this.service.ask(this.campaignId(), question).subscribe({
      next: (res) => {
        this.answer.set(res);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(err.error?.detail ?? 'Something went wrong. Please try again.');
      },
    });
  }
}
