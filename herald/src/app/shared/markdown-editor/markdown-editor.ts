import {
  Component,
  ElementRef,
  computed,
  effect,
  forwardRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBold,
  lucideCode,
  lucideEye,
  lucideHeading1,
  lucideHeading2,
  lucideHeading3,
  lucideItalic,
  lucideLink,
  lucideList,
  lucideListChecks,
  lucideListOrdered,
  lucideMinus,
  lucidePencil,
  lucideQuote,
  lucideSquareCode,
  lucideStrikethrough,
  lucideTable,
} from '@ng-icons/lucide';

import { inputVariants } from '@/components/input/input.variants';
import { Entity } from '@/core/api/models';
import { MarkdownView } from '@/shared/markdown-view/markdown-view';
import { mergeClasses } from '@/utils/merge-classes';

import { getCaretCoordinates } from './caret-coordinates';
import { MarkdownCommand, applyCommand } from './markdown-commands';

interface ToolbarButton {
  command: MarkdownCommand;
  icon: string;
  label: string;
  /** Ctrl/Cmd shortcut key, shown in the tooltip and handled on keydown. */
  key?: string;
}

/** Grouped so the toolbar can render separators between inline / block / insert commands. */
const TOOLBAR: ToolbarButton[][] = [
  [
    { command: 'bold', icon: 'lucideBold', label: 'Bold', key: 'b' },
    { command: 'italic', icon: 'lucideItalic', label: 'Italic', key: 'i' },
    { command: 'strikethrough', icon: 'lucideStrikethrough', label: 'Strikethrough' },
    { command: 'code', icon: 'lucideCode', label: 'Inline code', key: 'e' },
  ],
  [
    { command: 'h1', icon: 'lucideHeading1', label: 'Heading 1' },
    { command: 'h2', icon: 'lucideHeading2', label: 'Heading 2' },
    { command: 'h3', icon: 'lucideHeading3', label: 'Heading 3' },
  ],
  [
    { command: 'ul', icon: 'lucideList', label: 'Bullet list' },
    { command: 'ol', icon: 'lucideListOrdered', label: 'Numbered list' },
    { command: 'task', icon: 'lucideListChecks', label: 'Task list' },
    { command: 'quote', icon: 'lucideQuote', label: 'Quote' },
  ],
  [
    { command: 'link', icon: 'lucideLink', label: 'Link', key: 'k' },
    { command: 'table', icon: 'lucideTable', label: 'Table' },
    { command: 'codeBlock', icon: 'lucideSquareCode', label: 'Code block' },
    { command: 'rule', icon: 'lucideMinus', label: 'Horizontal rule' },
  ],
];

const SHORTCUTS = new Map(
  TOOLBAR.flat()
    .filter((button) => button.key)
    .map((button) => [button.key!, button.command]),
);

interface MentionOption {
  name: string;
  create: boolean;
}

// A '@' at the start or after whitespace, then the fragment typed so far up to the caret. The
// fragment may contain spaces (entity names do — "The Balrog"), but not brackets/newlines/another
// '@'. Excludes emails (a@b), since '@' must follow whitespace or the start.
const MENTION_QUERY_RE = /(^|\s)@([^@[\]\n]*)$/;
const MAX_OPTIONS = 8;

/**
 * The Markdown input used everywhere notes/descriptions are written: a plain textarea (so the
 * raw Markdown stays the canonical text) plus a formatting toolbar, keyboard shortcuts, a
 * rendered preview, and — when `mentions` is on — the `@`-entity typeahead.
 *
 * A `ControlValueAccessor`, so it drops into reactive forms with `formControlName`; it also
 * accepts a plain `[value]`/`(valueChange)` pair for the modals that edit JSONB rows directly.
 */
@Component({
  selector: 'app-markdown-editor',
  imports: [NgIcon, MarkdownView],
  templateUrl: './markdown-editor.html',
  viewProviders: [
    provideIcons({
      lucideBold,
      lucideItalic,
      lucideStrikethrough,
      lucideCode,
      lucideHeading1,
      lucideHeading2,
      lucideHeading3,
      lucideList,
      lucideListOrdered,
      lucideListChecks,
      lucideQuote,
      lucideLink,
      lucideTable,
      lucideSquareCode,
      lucideMinus,
      lucideEye,
      lucidePencil,
    }),
  ],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MarkdownEditor), multi: true },
  ],
  host: {
    // A static `placeholder="…"` in a host template feeds the input *and* stays on this element,
    // so a placeholder/label lookup would match both the host and the real textarea. Strip them.
    '[attr.placeholder]': 'null',
    '[attr.arialabel]': 'null',
  },
})
export class MarkdownEditor implements ControlValueAccessor {
  /** Value for non-form usage; `formControlName` drives the same state via `writeValue`. */
  readonly value = input<string | null>(null);
  readonly valueChange = output<string>();
  /** The value at the moment focus leaves — the `(change)`-on-blur hook for save-on-blur hosts. */
  readonly commit = output<string>();

  readonly rows = input(10);
  readonly placeholder = input('');
  readonly ariaLabel = input('');
  /** Show the Write/Preview toggle. Off where the host already renders its own preview pane. */
  readonly preview = input(true);
  /** Enable the `@`-mention typeahead (session notes only — descriptions don't tag entities). */
  readonly mentions = input(false);
  /** Campaign entities offered by the typeahead. */
  readonly entities = input<Entity[]>([]);
  /** A mention typed for a name that doesn't exist yet, so the host can persist it. */
  readonly create = output<string>();

  // Zard input styling applied directly: we can't use the `z-input` directive here because it
  // is itself a value accessor, and its value-writing effect would fight ours (blanking loaded
  // notes). Reusing the variant keeps the look identical.
  protected readonly textareaClass = mergeClasses(
    inputVariants({ zType: 'textarea' }),
    'w-full rounded-t-none font-mono text-sm',
  );
  protected readonly toolClass =
    'inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-40';
  protected readonly toggleClass =
    'ml-auto inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground';

  protected readonly groups = TOOLBAR;

  private readonly textareaRef = viewChild<ElementRef<HTMLTextAreaElement>>('ta');

  protected readonly mode = signal<'write' | 'preview'>('write');
  /** Mirrors the textarea's text so the preview re-renders as you type. */
  protected readonly text = signal('');

  protected readonly open = signal(false);
  protected readonly options = signal<MentionOption[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly top = signal(0);
  protected readonly left = signal(0);

  /** Value pushed in from the form (writeValue) or the `value` input, applied once the DOM exists. */
  private readonly pendingValue = signal('');
  /** Index of the '@' that started the active mention, or -1 when none. */
  private mentionStart = -1;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  protected readonly shortcutHint = computed(() =>
    typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.userAgent) ? '⌘' : 'Ctrl+',
  );

  constructor() {
    effect(() => {
      const incoming = this.value();
      if (incoming !== null) this.pendingValue.set(incoming);
    });
    effect(() => {
      const el = this.textareaRef()?.nativeElement;
      const value = this.pendingValue();
      this.text.set(value);
      if (el && el.value !== value) el.value = value;
    });
  }

  // --- ControlValueAccessor ---
  writeValue(value: string | null): void {
    this.pendingValue.set(value ?? '');
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    const el = this.textareaRef()?.nativeElement;
    if (el) el.disabled = isDisabled;
  }

  private emit(value: string): void {
    this.text.set(value);
    this.onChange(value);
    this.valueChange.emit(value);
  }

  // --- toolbar ---
  protected run(command: MarkdownCommand): void {
    const el = this.textareaRef()?.nativeElement;
    if (!el) return;
    const next = applyCommand(
      {
        value: el.value,
        selectionStart: el.selectionStart ?? el.value.length,
        selectionEnd: el.selectionEnd ?? el.value.length,
      },
      command,
    );
    el.value = next.value;
    el.setSelectionRange(next.selectionStart, next.selectionEnd);
    el.focus();
    this.emit(next.value);
    this.close();
  }

  protected tooltip(button: ToolbarButton): string {
    return button.key
      ? `${button.label} (${this.shortcutHint()}${button.key.toUpperCase()})`
      : button.label;
  }

  // --- textarea events ---
  protected onInput(): void {
    const el = this.textareaRef()!.nativeElement;
    this.emit(el.value);
    this.sync();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey) {
      const command = SHORTCUTS.get(event.key.toLowerCase());
      if (command && !event.altKey) {
        event.preventDefault();
        this.run(command);
        return;
      }
    }
    if (!this.open()) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        this.choose(this.activeIndex());
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
    }
  }

  protected onKeyup(event: KeyboardEvent): void {
    // These are handled on keydown while open; re-syncing here would reset the highlight.
    if (this.open() && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      return;
    }
    this.sync();
  }

  protected onBlur(): void {
    this.onTouched();
    this.close();
    this.commit.emit(this.text());
  }

  // --- mention state ---
  protected sync(): void {
    const el = this.textareaRef()?.nativeElement;
    if (!el || !this.mentions()) return;
    const caret = el.selectionStart ?? el.value.length;
    const match = MENTION_QUERY_RE.exec(el.value.slice(0, caret));
    if (!match) {
      this.close();
      return;
    }
    const query = match[2];
    this.mentionStart = caret - query.length - 1;
    this.buildOptions(query);
    if (this.options().length === 0) {
      this.close();
      return;
    }
    this.activeIndex.set(0);
    const coords = getCaretCoordinates(el, this.mentionStart);
    this.top.set(coords.top - el.scrollTop + coords.height);
    this.left.set(coords.left - el.scrollLeft);
    this.open.set(true);
  }

  private buildOptions(query: string): void {
    const q = query.trim().toLowerCase();
    const options: MentionOption[] = this.entities()
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .slice(0, MAX_OPTIONS)
      .map((e) => ({ name: e.name, create: false }));
    const exact = this.entities().some((e) => e.name.toLowerCase() === q);
    if (q && !exact) options.push({ name: query.trim(), create: true });
    this.options.set(options);
  }

  private move(delta: number): void {
    const count = this.options().length;
    if (count === 0) return;
    this.activeIndex.set((this.activeIndex() + delta + count) % count);
  }

  protected choose(index: number): void {
    const option = this.options()[index];
    const el = this.textareaRef()?.nativeElement;
    if (!option || !el || this.mentionStart < 0) return;
    const caret = el.selectionStart ?? el.value.length;
    const token = `@[${option.name}]`;
    const value = el.value.slice(0, this.mentionStart) + token + el.value.slice(caret);
    el.value = value;
    const position = this.mentionStart + token.length;
    el.setSelectionRange(position, position);
    this.emit(value);
    if (option.create) this.create.emit(option.name);
    this.close();
    el.focus();
  }

  private close(): void {
    this.open.set(false);
    this.mentionStart = -1;
  }
}
