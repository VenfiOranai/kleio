import { Component, computed, inject, input, output, signal, viewChild } from '@angular/core';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { EquipmentItem, ReferenceRecord } from '@/core/api/models';
import { ReferenceService } from '@/core/api/reference.service';
import { MarkdownEditor } from '@/shared/markdown-editor/markdown-editor';
import { Modal } from '@/shared/modal/modal';
import { ReferenceModal } from '../reference-modal/reference-modal';

/** Display label for items left without a category (their stored category stays ''). */
const UNCATEGORIZED = 'Uncategorized';

/** An item plus a transient client id so `@for` tracking survives in-place edits. */
interface WorkItem extends EquipmentItem {
  _id: number;
}

let nextId = 0;

function blankItem(): EquipmentItem {
  return {
    name: '',
    quantity: 1,
    category: '',
    weight: null,
    equipped: false,
    attuned: false,
    description: '',
  };
}

@Component({
  selector: 'app-equipment-modal',
  imports: [Modal, ZardButtonComponent, ZardInputDirective, MarkdownEditor, ReferenceModal],
  templateUrl: './equipment-modal.html',
})
export class EquipmentModal {
  /** Current items from the sheet; copied into an editable working set when opened. */
  readonly items = input<EquipmentItem[]>([]);
  /** Emitted (with a plain-item list) on every edit so the sheet's summary stays live. */
  readonly itemsChange = output<EquipmentItem[]>();

  private readonly modal = viewChild.required(Modal);
  private readonly reference = viewChild.required(ReferenceModal);
  private readonly referenceService = inject(ReferenceService);
  /** Hides the Browse button unless a 5etools dataset is mounted (see ReferenceService). */
  protected readonly referenceAvailable = this.referenceService.available;

  protected readonly working = signal<WorkItem[]>([]);
  protected readonly search = signal('');
  protected readonly equippedOnly = signal(false);
  protected readonly collapsed = signal<Set<string>>(new Set());

  /** Distinct non-empty categories already in use, for the category-picker datalist. */
  protected readonly usedCategories = computed(() =>
    [...new Set(this.working().map((i) => i.category).filter((c) => c.trim()))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  protected readonly totalWeight = computed(() =>
    round2(this.working().reduce((sum, i) => sum + (i.quantity || 0) * (i.weight || 0), 0)),
  );
  protected readonly attunedCount = computed(
    () => this.working().filter((i) => i.attuned).length,
  );

  /** Matching items grouped by category — custom categories alphabetically, then Uncategorized. */
  protected readonly groups = computed(() => {
    const q = this.search().trim().toLowerCase();
    const equippedOnly = this.equippedOnly();
    const byCat = new Map<string, WorkItem[]>();
    for (const item of this.working()) {
      if (q && !item.name.toLowerCase().includes(q)) continue;
      if (equippedOnly && !item.equipped) continue;
      (byCat.get(item.category) ?? byCat.set(item.category, []).get(item.category)!).push(item);
    }
    return [...byCat.keys()]
      .sort((a, b) => {
        if (a === '') return 1; // Uncategorized sinks to the bottom.
        if (b === '') return -1;
        return a.localeCompare(b);
      })
      .map((category) => ({
        category,
        label: category || UNCATEGORIZED,
        items: byCat.get(category)!.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  });

  open(): void {
    // Lazily resolves whether reference import is available (once per session).
    this.referenceService.ensureStatus();
    this.working.set(this.items().map((i) => ({ ...i, _id: nextId++ })));
    this.search.set('');
    this.equippedOnly.set(false);
    this.collapsed.set(new Set());
    this.modal().open();
  }

  protected isCollapsed(category: string): boolean {
    return this.collapsed().has(category);
  }

  protected toggleCollapsed(category: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      next.has(category) ? next.delete(category) : next.add(category);
      return next;
    });
  }

  protected addItem(): void {
    this.working.update((w) => [...w, { ...blankItem(), _id: nextId++ }]);
    this.emit();
  }

  /** Browse the 5etools reference and import full items — still editable afterwards. */
  protected browse(): void {
    this.reference().open('item');
  }

  protected importItem(record: ReferenceRecord): void {
    if (!record.item) return;
    this.working.update((w) => [...w, { ...record.item!, _id: nextId++ }]);
    this.emit();
  }

  protected duplicate(item: WorkItem): void {
    this.working.update((w) => {
      const copy = { ...item, _id: nextId++ };
      const idx = w.indexOf(item);
      return [...w.slice(0, idx + 1), copy, ...w.slice(idx + 1)];
    });
    this.emit();
  }

  protected remove(item: WorkItem): void {
    this.working.update((w) => w.filter((i) => i !== item));
    this.emit();
  }

  protected setText(item: WorkItem, field: 'name' | 'category' | 'description', value: string): void {
    item[field] = value;
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected setQuantity(item: WorkItem, value: string): void {
    item.quantity = Math.max(0, Math.floor(Number(value) || 0));
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected adjustQuantity(item: WorkItem, delta: number): void {
    item.quantity = Math.max(0, (item.quantity || 0) + delta);
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected setWeight(item: WorkItem, value: string): void {
    item.weight = value === '' ? null : Number(value);
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected toggle(item: WorkItem, field: 'equipped' | 'attuned'): void {
    item[field] = !item[field];
    this.working.update((w) => [...w]);
    this.emit();
  }

  private emit(): void {
    this.itemsChange.emit(this.working().map(({ _id, ...rest }) => rest));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
