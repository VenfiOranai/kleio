import { signal } from '@angular/core';

/** A popover anchored to a chip in one of the read-only sheet previews. */
export interface PopoverState<T> {
  data: T;
  top: number;
  left: number;
  /** Pinned popovers survive mouseleave and take the pointer; see `PinnablePopover`. */
  pinned: boolean;
  /** The chip it opened from, so the click that pins it isn't read as a click outside. */
  anchor: HTMLElement | null;
}

/** Nudge a rendered popover back on screen; null when it already fits (or isn't shown). */
export function clampToViewport<T extends { top: number; left: number }>(
  el: HTMLElement | undefined,
  tip: T | null,
): T | null {
  if (!el || !tip) return null;
  const margin = 8;
  const { width, height } = el.getBoundingClientRect();
  const left = Math.max(margin, Math.min(tip.left, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(tip.top, window.innerHeight - height - margin));
  return left === tip.left && top === tip.top ? null : { ...tip, top, left };
}

/**
 * A details popover that opens on hover and can be **pinned** by clicking its chip.
 *
 * Unpinned it is `pointer-events-none` in the template — it has to be, or it would steal the
 * hover from the chip it's anchored to — which makes a popover taller than its max height
 * impossible to scroll. Pinning fixes that: the popover stays put when the pointer leaves the
 * chip, becomes interactive, and ignores hovers over other chips, until it's dismissed by a click
 * outside its own contents (`closeIfOutside`), Escape, or a second click of the same chip.
 *
 * One instance per preview section (spells, features); the component owns the rendered element
 * and hands it over as `el` for clamping and outside-click hit-testing.
 */
export class PinnablePopover<T> {
  private readonly tip = signal<PopoverState<T> | null>(null);

  /** The popover to render, if any. */
  readonly state = this.tip.asReadonly();

  constructor(private readonly el: () => HTMLElement | undefined) {}

  /** Open on hover — a pinned popover wins, so hovering elsewhere leaves it in place. */
  show(event: MouseEvent, data: T): void {
    if (this.tip()?.pinned) return;
    this.open(event, data, false);
  }

  /** Close on mouseleave, unless pinned. */
  hide(): void {
    if (this.tip()?.pinned) return;
    this.close();
  }

  /** Pin on click, so the popover can be reached and scrolled; clicking the same chip unpins. */
  pin(event: MouseEvent, data: T): void {
    const tip = this.tip();
    if (tip?.pinned && tip.data === data) {
      this.close();
      return;
    }
    this.open(event, data, true);
  }

  close(): void {
    this.tip.set(null);
  }

  /** Escape dismisses a pinned popover (an unpinned one follows the pointer anyway). */
  unpin(): void {
    if (this.tip()?.pinned) this.close();
  }

  /** Dismiss a pinned popover when a click lands outside it and its chip. */
  closeIfOutside(target: Node | null): void {
    const tip = this.tip();
    if (!tip?.pinned || !target) return;
    if (tip.anchor?.contains(target) || this.el()?.contains(target)) return;
    this.close();
  }

  private open(event: MouseEvent, data: T, pinned: boolean): void {
    const anchor = event.currentTarget as HTMLElement;
    const rect = anchor.getBoundingClientRect();
    this.tip.set({ data, top: rect.top, left: rect.right + 8, pinned, anchor });
    requestAnimationFrame(() => {
      const clamped = clampToViewport(this.el(), this.tip());
      if (clamped) this.tip.set(clamped);
    });
  }
}
