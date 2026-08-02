import { describe, expect, it } from 'vitest';

import { Feature, FeatureSource, FeatureUses } from '@/core/api/models';

import { groupFeaturesBySource, rechargeLabel, rechargePhrase, toggleUseDot, useDots } from './features';

const feature = (name: string, source: FeatureSource, level: number | null = null): Feature => ({
  name,
  source,
  level,
  uses: null,
  description: '',
});

const uses = (max: number, expended: number): FeatureUses => ({ max, expended, recharge: 'long' });

describe('groupFeaturesBySource', () => {
  it('buckets features by source in the canonical order', () => {
    const groups = groupFeaturesBySource([
      feature('Lucky', 'feat'),
      feature('Darkvision', 'race'),
      feature('Rage', 'class'),
    ]);

    expect(groups.map((g) => [g.source, g.label])).toEqual([
      ['class', 'Class'],
      ['race', 'Race'],
      ['feat', 'Feat'],
    ]);
    expect(groups[0].features.map((f) => f.name)).toEqual(['Rage']);
  });

  it('orders a group by level, lowest first', () => {
    const groups = groupFeaturesBySource([
      feature('Extra Attack', 'class', 5),
      feature('Rage', 'class', 1),
      feature('Brutal Critical', 'class', 9),
    ]);

    expect(groups[0].features.map((f) => f.name)).toEqual(['Rage', 'Extra Attack', 'Brutal Critical']);
  });

  it('sorts unleveled features last, breaking ties by name', () => {
    const groups = groupFeaturesBySource([
      feature('Zealous Presence', 'class', null),
      feature('Aspect of the Beast', 'class', null),
      feature('Rage', 'class', 3),
    ]);

    expect(groups[0].features.map((f) => f.name)).toEqual([
      'Rage',
      'Aspect of the Beast',
      'Zealous Presence',
    ]);
  });

  it('leaves the input array untouched', () => {
    const input = [feature('Extra Attack', 'class', 5), feature('Rage', 'class', 1)];

    groupFeaturesBySource(input);

    expect(input.map((f) => f.name)).toEqual(['Extra Attack', 'Rage']);
  });

  it('keeps an unrecognised source visible, bucketed last', () => {
    // Reachable by pasting through the JSON view.
    const groups = groupFeaturesBySource([
      feature('Mystery', 'homebrew' as FeatureSource),
      feature('Rage', 'class', 1),
    ]);

    expect(groups.map((g) => g.label)).toEqual(['Class', 'homebrew']);
  });
});

describe('useDots', () => {
  it('renders available uses first', () => {
    expect(useDots(uses(3, 1))).toEqual([true, true, false]);
    expect(useDots(uses(2, 0))).toEqual([true, true]);
    expect(useDots(uses(2, 2))).toEqual([false, false]);
  });
});

describe('toggleUseDot', () => {
  it('expends down to a clicked available dot', () => {
    expect(toggleUseDot(uses(3, 0), 1)).toBe(2);
  });

  it('restores back up through a clicked expended dot', () => {
    expect(toggleUseDot(uses(3, 2), 2)).toBe(0);
  });
});

describe('recharge wording', () => {
  it('reads naturally in both the tracker row and the popover', () => {
    expect(rechargeLabel('short')).toBe('short rest');
    expect(rechargeLabel('other')).toBe('special');
    expect(rechargePhrase('long')).toBe('Recharges on a long rest');
    expect(rechargePhrase('other')).toBe('Special recharge');
  });
});
