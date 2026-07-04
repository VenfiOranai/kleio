import { Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import DOMPurify from 'dompurify';
import { marked, type TokenizerAndRendererExtension } from 'marked';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Renders an @[Name] entity mention as a bold+italic link to the global search for that name
// (the '@' and brackets are dropped). Registered once, globally, for every markdown view.
const mentionExtension: TokenizerAndRendererExtension = {
  name: 'mention',
  level: 'inline',
  start: (src: string) => src.indexOf('@['),
  tokenizer(src: string) {
    const match = /^@\[([^\[\]\n]+)\]/.exec(src);
    if (!match) return undefined;
    return { type: 'mention', raw: match[0], text: match[1].trim() };
  },
  renderer(token) {
    const name = token['text'] as string;
    const href = `/search?q=${encodeURIComponent(name)}`;
    return `<a class="entity-mention" href="${href}"><strong><em>${escapeHtml(name)}</em></strong></a>`;
  },
};

marked.use({ extensions: [mentionExtension] });

@Component({
  selector: 'app-markdown-view',
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.css',
  // ViewEncapsulation.None so styles apply to the [innerHTML]-rendered markdown;
  // selectors are scoped under `.markdown` to avoid leaking globally.
  encapsulation: ViewEncapsulation.None,
  host: { '(click)': 'onClick($event)' },
})
export class MarkdownView {
  private readonly router = inject(Router);

  readonly source = input('');

  protected readonly html = computed(() => {
    const rendered = marked.parse(this.source() ?? '', { async: false }) as string;
    return DOMPurify.sanitize(rendered);
  });

  /** Route entity-mention clicks through the SPA router instead of a full page load. */
  protected onClick(event: MouseEvent): void {
    // Let modified clicks (new tab / window) behave natively.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    const link = (event.target as HTMLElement)?.closest?.('a.entity-mention');
    const href = link?.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    this.router.navigateByUrl(href);
  }
}
