import {
  Component,
  ElementRef,
  effect,
  forwardRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { inputVariants } from '@/components/input/input.variants';
import { Entity } from '@/core/api/models';
import { mergeClasses } from '@/utils/merge-classes';

import { getCaretCoordinates } from './caret-coordinates';

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
 * A textarea (ControlValueAccessor) with an @-mention typeahead: type `@`, pick an existing
 * entity or create a new one, and an `@[Name]` token is inserted. Emits `create` with the new
 * name so the host can persist it.
 */
@Component({
  selector: 'app-mention-textarea',
  templateUrl: './mention-textarea.html',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MentionTextarea), multi: true },
  ],
})
export class MentionTextarea implements ControlValueAccessor {
  readonly entities = input<Entity[]>([]);
  readonly rows = input(18);
  readonly placeholder = input('');
  readonly create = output<string>();

  // Zard input styling applied directly: we can't use the `z-input` directive here because it
  // is itself a value accessor, and its value-writing effect would fight ours (blanking loaded
  // notes). Reusing the variant keeps the look identical.
  protected readonly textareaClass = mergeClasses(
    inputVariants({ zType: 'textarea' }),
    'w-full font-mono text-sm',
  );

  private readonly textareaRef = viewChild<ElementRef<HTMLTextAreaElement>>('ta');

  protected readonly open = signal(false);
  protected readonly options = signal<MentionOption[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly top = signal(0);
  protected readonly left = signal(0);

  /** Value pushed in from the form (writeValue), applied to the textarea once it exists. */
  private readonly pendingValue = signal('');
  /** Index of the '@' that started the active mention, or -1 when none. */
  private mentionStart = -1;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    effect(() => {
      const el = this.textareaRef()?.nativeElement;
      const value = this.pendingValue();
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

  // --- textarea events ---
  protected onInput(): void {
    const el = this.textareaRef()!.nativeElement;
    this.onChange(el.value);
    this.sync();
  }

  protected onKeydown(event: KeyboardEvent): void {
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
  }

  // --- mention state ---
  protected sync(): void {
    const el = this.textareaRef()?.nativeElement;
    if (!el) return;
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
    this.onChange(value);
    if (option.create) this.create.emit(option.name);
    this.close();
    el.focus();
  }

  private close(): void {
    this.open.set(false);
    this.mentionStart = -1;
  }
}
