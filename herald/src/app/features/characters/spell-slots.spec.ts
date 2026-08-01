import { describe, expect, it } from 'vitest';

import { clampExpended, slotDots, toggleSlotDot } from './spell-slots';

const slot = (total: number, expended: number) => ({ level: 3, total, expended });

describe('slotDots', () => {
  it('renders available dots first', () => {
    expect(slotDots(slot(4, 1))).toEqual([true, true, true, false]);
  });

  it('handles the empty and full extremes', () => {
    expect(slotDots(slot(3, 0))).toEqual([true, true, true]);
    expect(slotDots(slot(3, 3))).toEqual([false, false, false]);
    expect(slotDots(slot(0, 0))).toEqual([]);
  });
});

describe('toggleSlotDot', () => {
  it('spends down to a clicked available dot', () => {
    // [x x x o] → click the last available dot (index 2) → [x x o o]
    expect(toggleSlotDot(slot(4, 1), 2)).toBe(2);
    // Clicking the first dot spends everything.
    expect(toggleSlotDot(slot(4, 1), 0)).toBe(4);
  });

  it('restores back up through a clicked expended dot', () => {
    // [x o o] → click index 2 → all three available again
    expect(toggleSlotDot(slot(3, 2), 2)).toBe(0);
    // [x o o] → click index 1 → [x x o]
    expect(toggleSlotDot(slot(3, 2), 1)).toBe(1);
  });

  it('round-trips: expending a dot then clicking it again restores it', () => {
    const start = slot(4, 0);
    const expended = toggleSlotDot(start, 3); // spend the last dot
    expect(expended).toBe(1);
    expect(toggleSlotDot({ ...start, expended }, 3)).toBe(0);
  });

  it('never leaves the count outside the pool', () => {
    expect(toggleSlotDot(slot(2, 2), 0)).toBe(1);
    expect(toggleSlotDot(slot(2, 0), 1)).toBe(1);
  });
});

describe('clampExpended', () => {
  it('bounds the count to the pool', () => {
    expect(clampExpended(3, 5)).toBe(3);
    expect(clampExpended(3, -1)).toBe(0);
    expect(clampExpended(0, 2)).toBe(0);
  });
});
