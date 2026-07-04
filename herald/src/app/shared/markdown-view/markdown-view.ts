import { Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import DOMPurify from 'dompurify';
import { marked, type TokenizerAndRendererExtension } from 'marked';

import { Entity } from '@/core/api/models';

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

/** Parse Markdown to sanitized HTML. Shared by the main view and the mention tooltip. */
function renderMarkdown(source: string): string {
  const rendered = marked.parse(source ?? '', { async: false }) as string;
  return DOMPurify.sanitize(rendered);
}

interface MentionTooltip {
  /** Canonical entity name, shown as the tooltip's title. */
  name: string;
  /** Rendered-Markdown description body. */
  html: string;
  top: number;
  left: number;
}

@Component({
  selector: 'app-markdown-view',
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.css',
  // ViewEncapsulation.None so styles apply to the [innerHTML]-rendered markdown;
  // selectors are scoped under `.markdown` to avoid leaking globally.
  encapsulation: ViewEncapsulation.None,
  host: {
    '(click)': 'onClick($event)',
    '(mouseover)': 'onMouseOver($event)',
    '(mouseout)': 'onMouseOut($event)',
  },
})
export class MarkdownView {
  private readonly router = inject(Router);

  readonly source = input('');
  /** Campaign entities — supplies each mention's description for the hover tooltip. */
  readonly entities = input<Entity[]>([]);

  protected readonly html = computed(() => renderMarkdown(this.source()));

  protected readonly tooltip = signal<MentionTooltip | null>(null);

  /** Lower-cased entity name → the entity, for those that have a (non-empty) description. */
  private readonly described = computed(() => {
    const map = new Map<string, Entity>();
    for (const entity of this.entities()) {
      if (entity.description?.trim()) map.set(entity.name.toLowerCase(), entity);
    }
    return map;
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

  /** Show a tooltip (to the right) with the entity's description when hovering a mention. */
  protected onMouseOver(event: MouseEvent): void {
    const link = (event.target as HTMLElement)?.closest?.('a.entity-mention') as HTMLElement | null;
    if (!link) return;
    const entity = this.described().get((link.textContent ?? '').trim().toLowerCase());
    if (!entity) return;
    const rect = link.getBoundingClientRect();
    this.tooltip.set({
      name: entity.name,
      html: renderMarkdown(entity.description ?? ''),
      top: rect.top,
      left: rect.right + 8,
    });
  }

  protected onMouseOut(event: MouseEvent): void {
    const link = (event.target as HTMLElement)?.closest?.('a.entity-mention');
    if (!link) return;
    // Moving between the mention's own child nodes (e.g. into the <em>) shouldn't dismiss it.
    const to = event.relatedTarget as Node | null;
    if (to && link.contains(to)) return;
    this.tooltip.set(null);
  }
}
