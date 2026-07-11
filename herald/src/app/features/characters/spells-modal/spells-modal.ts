import { Component, computed, input, output, signal, viewChild } from '@angular/core';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { SPELL_SCHOOLS, Spell, SpellSlot } from '@/core/api/models';
import { Modal } from '@/shared/modal/modal';

/** A spell plus a transient client id so `@for` tracking survives in-place edits. */
interface WorkSpell extends Spell {
  _id: number;
}

let nextId = 0;

const SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/** Slot-bearing levels 1–9 (cantrips have no slots). */
const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function blankSpell(level = 0): Spell {
  return {
    name: '',
    level,
    school: '',
    prepared: false,
    always_prepared: false,
    ritual: false,
    concentration: false,
    casting_time: '',
    range: '',
    components: '',
    duration: '',
    description: '',
  };
}

function levelLabel(level: number): string {
  return level === 0 ? 'Cantrips' : `Level ${level}`;
}

@Component({
  selector: 'app-spells-modal',
  imports: [Modal, ZardButtonComponent, ZardInputDirective],
  templateUrl: './spells-modal.html',
})
export class SpellsModal {
  /** Current spells + slots from the sheet; copied into editable working sets when opened. */
  readonly spells = input<Spell[]>([]);
  readonly spellSlots = input<SpellSlot[]>([]);
  /** Read-only spellcasting header, mirrored from the sheet's server-computed `derived`. */
  readonly spellcastingAbility = input('');
  readonly spellSaveDc = input<number | null>(null);
  readonly spellAttackBonus = input<number | null>(null);

  /** Emitted (as plain lists) on every edit so the sheet's summary + save stay live. */
  readonly spellsChange = output<Spell[]>();
  readonly spellSlotsChange = output<SpellSlot[]>();

  private readonly modal = viewChild.required(Modal);

  protected readonly schools = SPELL_SCHOOLS;
  protected readonly levels = SPELL_LEVELS;
  protected readonly slotLevels = SLOT_LEVELS;

  protected readonly working = signal<WorkSpell[]>([]);
  /** Full levels 1–9 working slot rows (missing input levels default to zero). */
  protected readonly slots = signal<SpellSlot[]>([]);

  protected readonly search = signal('');
  protected readonly preparedOnly = signal(false);
  protected readonly ritualOnly = signal(false);
  /** -1 = all levels. */
  protected readonly levelFilter = signal(-1);

  protected readonly preparedCount = computed(
    () => this.working().filter((s) => s.prepared || s.always_prepared).length,
  );

  /** Slot levels that carry any slots (total > 0) — the only ones with dot trackers shown. */
  protected readonly activeSlots = computed(() => this.slots().filter((s) => s.total > 0));

  /** Matching spells grouped by level (Cantrips first, then 1→9). */
  protected readonly groups = computed(() => {
    const q = this.search().trim().toLowerCase();
    const preparedOnly = this.preparedOnly();
    const ritualOnly = this.ritualOnly();
    const levelFilter = this.levelFilter();
    const byLevel = new Map<number, WorkSpell[]>();
    for (const spell of this.working()) {
      if (q && !spell.name.toLowerCase().includes(q)) continue;
      if (preparedOnly && !spell.prepared && !spell.always_prepared) continue;
      if (ritualOnly && !spell.ritual) continue;
      if (levelFilter >= 0 && spell.level !== levelFilter) continue;
      (byLevel.get(spell.level) ?? byLevel.set(spell.level, []).get(spell.level)!).push(spell);
    }
    return [...byLevel.keys()]
      .sort((a, b) => a - b)
      .map((level) => ({
        level,
        label: levelLabel(level),
        spells: byLevel.get(level)!.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  });

  open(): void {
    this.working.set(this.spells().map((s) => ({ ...s, _id: nextId++ })));
    this.slots.set(
      SLOT_LEVELS.map((level) => {
        const existing = this.spellSlots().find((s) => s.level === level);
        return { level, total: existing?.total ?? 0, expended: existing?.expended ?? 0 };
      }),
    );
    this.search.set('');
    this.preparedOnly.set(false);
    this.ritualOnly.set(false);
    this.levelFilter.set(-1);
    this.modal().open();
  }

  // --- Spell editing -------------------------------------------------------

  protected addSpell(): void {
    const level = this.levelFilter() >= 0 ? this.levelFilter() : 0;
    this.working.update((w) => [...w, { ...blankSpell(level), _id: nextId++ }]);
    this.emitSpells();
  }

  protected duplicate(spell: WorkSpell): void {
    this.working.update((w) => {
      const copy = { ...spell, _id: nextId++ };
      const idx = w.indexOf(spell);
      return [...w.slice(0, idx + 1), copy, ...w.slice(idx + 1)];
    });
    this.emitSpells();
  }

  protected remove(spell: WorkSpell): void {
    this.working.update((w) => w.filter((s) => s !== spell));
    this.emitSpells();
  }

  protected setText(
    spell: WorkSpell,
    field: 'name' | 'school' | 'casting_time' | 'range' | 'components' | 'duration' | 'description',
    value: string,
  ): void {
    spell[field] = value;
    this.working.update((w) => [...w]);
    this.emitSpells();
  }

  protected setLevel(spell: WorkSpell, value: string): void {
    spell.level = Math.min(9, Math.max(0, Math.floor(Number(value) || 0)));
    this.working.update((w) => [...w]);
    this.emitSpells();
  }

  protected toggle(
    spell: WorkSpell,
    field: 'prepared' | 'always_prepared' | 'ritual' | 'concentration',
  ): void {
    spell[field] = !spell[field];
    this.working.update((w) => [...w]);
    this.emitSpells();
  }

  // --- Slot tracking -------------------------------------------------------

  protected slotFor(level: number): SpellSlot {
    return this.slots().find((s) => s.level === level)!;
  }

  /** `expended` dots as [available, expended] booleans for a level's tracker. */
  protected slotDots(slot: SpellSlot): boolean[] {
    // true = still available, false = expended.
    return Array.from({ length: slot.total }, (_, i) => i >= slot.expended);
  }

  private updateSlot(level: number, patch: Partial<SpellSlot>): void {
    this.slots.update((rows) =>
      rows.map((s) => {
        if (s.level !== level) return s;
        const total = Math.max(0, patch.total ?? s.total);
        const expended = Math.min(total, Math.max(0, patch.expended ?? s.expended));
        return { level, total, expended };
      }),
    );
    this.emitSlots();
  }

  protected adjustSlotTotal(level: number, delta: number): void {
    this.updateSlot(level, { total: this.slotFor(level).total + delta });
  }

  protected setSlotTotal(level: number, value: string): void {
    this.updateSlot(level, { total: Math.floor(Number(value) || 0) });
  }

  /** Clicking a dot: expend if available, restore if already expended. */
  protected toggleDot(level: number, index: number): void {
    const slot = this.slotFor(level);
    // Dots render available-first; index < available means "spend down to here + 1".
    const available = slot.total - slot.expended;
    const expended = index >= available ? index : index + 1;
    this.updateSlot(level, { expended: slot.total - expended });
  }

  /** "Cast": expend one slot of the given level (used by both the tracker and per-spell buttons). */
  protected cast(level: number): void {
    const slot = this.slotFor(level);
    if (slot.expended < slot.total) this.updateSlot(level, { expended: slot.expended + 1 });
  }

  protected restore(level: number): void {
    const slot = this.slotFor(level);
    if (slot.expended > 0) this.updateSlot(level, { expended: slot.expended - 1 });
  }

  /** Whether a level has any un-expended slot to cast from (drives per-spell "Cast" enablement). */
  protected canCast(level: number): boolean {
    if (level < 1 || level > 9) return false;
    const slot = this.slotFor(level);
    return slot.total > slot.expended;
  }

  private emitSpells(): void {
    this.spellsChange.emit(this.working().map(({ _id, ...rest }) => rest));
  }

  private emitSlots(): void {
    // Persist only levels that carry slots, keeping the stored list tidy.
    this.spellSlotsChange.emit(this.slots().filter((s) => s.total > 0));
  }
}
