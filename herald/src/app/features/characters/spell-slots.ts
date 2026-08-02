import { SpellSlot } from '@/core/api/models';

/**
 * Spell-slot tracker maths, shared by the sheet's read-only preview and the spells modal so
 * both trackers behave identically. Pure — no signals, no DOM.
 *
 * Only the counts matter, so the same maths drives the features' limited-use dots (via
 * `features.ts`) — hence `Pool` rather than a full `SpellSlot`.
 */
type Pool = Pick<SpellSlot, 'total' | 'expended'>;

/** A slot row's dots, available-first: `true` = still available, `false` = expended. */
export function slotDots(slot: Pool): boolean[] {
  const available = slot.total - slot.expended;
  return Array.from({ length: Math.max(0, slot.total) }, (_, i) => i < available);
}

/**
 * The `expended` count after clicking the dot at `index`: clicking an available dot spends
 * down to it, clicking an expended one restores back up through it.
 */
export function toggleSlotDot(slot: Pool, index: number): number {
  const available = slot.total - slot.expended;
  const nextAvailable = index < available ? index : index + 1;
  return clampExpended(slot.total, slot.total - nextAvailable);
}

/** Keep an `expended` count inside `[0, total]`. */
export function clampExpended(total: number, expended: number): number {
  return Math.min(Math.max(0, total), Math.max(0, expended));
}
