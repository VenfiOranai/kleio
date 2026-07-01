import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

@Component({
  selector: 'app-markdown-view',
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.css',
  // ViewEncapsulation.None so styles apply to the [innerHTML]-rendered markdown;
  // selectors are scoped under `.markdown` to avoid leaking globally.
  encapsulation: ViewEncapsulation.None,
})
export class MarkdownView {
  readonly source = input('');

  protected readonly html = computed(() => {
    const rendered = marked.parse(this.source() ?? '', { async: false }) as string;
    return DOMPurify.sanitize(rendered);
  });
}
