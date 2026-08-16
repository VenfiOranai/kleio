import { describe, expect, it } from 'vitest';

import { PinnablePopover } from './popover';

/** The hover/pin state machine shared by the spells and features previews. */
describe('PinnablePopover', () => {
  /** A chip to anchor to, and the mouse event that would come from it. */
  function chip(): { el: HTMLElement; event: MouseEvent } {
    const el = document.createElement('button');
    document.body.appendChild(el);
    return { el, event: { currentTarget: el } as unknown as MouseEvent };
  }

  function makePopover(el?: HTMLElement) {
    return new PinnablePopover<string>(() => el);
  }

  it('opens on hover and closes on leave', () => {
    const popover = makePopover();
    popover.show(chip().event, 'Shield');

    expect(popover.state()?.data).toBe('Shield');
    expect(popover.state()?.pinned).toBe(false);

    popover.hide();
    expect(popover.state()).toBeNull();
  });

  it('survives leave once pinned, and ignores hovers over other chips', () => {
    const popover = makePopover();
    popover.pin(chip().event, 'Shield');
    popover.hide();

    expect(popover.state()?.data).toBe('Shield');
    expect(popover.state()?.pinned).toBe(true);

    popover.show(chip().event, 'Mage Hand');
    expect(popover.state()?.data).toBe('Shield');
  });

  it('re-pins to another chip that is clicked, and unpins the one clicked twice', () => {
    const popover = makePopover();
    const first = chip();
    popover.pin(first.event, 'Shield');
    popover.pin(chip().event, 'Mage Hand');

    expect(popover.state()?.data).toBe('Mage Hand');

    popover.pin(first.event, 'Shield'); // back to the first…
    popover.pin(first.event, 'Shield'); // …then off again
    expect(popover.state()).toBeNull();
  });

  it('closes on a click outside, but not on its own contents or its chip', () => {
    const rendered = document.createElement('div');
    const inside = document.createElement('p');
    rendered.appendChild(inside);
    document.body.appendChild(rendered);

    const popover = makePopover(rendered);
    const anchor = chip();
    popover.pin(anchor.event, 'Shield');

    popover.closeIfOutside(anchor.el); // the click that pinned it
    popover.closeIfOutside(inside); // dragging its scrollbar, following a link…
    expect(popover.state()?.data).toBe('Shield');

    popover.closeIfOutside(document.body);
    expect(popover.state()).toBeNull();
  });

  it('only unpins a popover that is pinned', () => {
    const popover = makePopover();
    popover.show(chip().event, 'Shield');
    popover.unpin();

    expect(popover.state()?.data).toBe('Shield'); // hover state is the pointer's business

    popover.pin(chip().event, 'Shield');
    popover.unpin();
    expect(popover.state()).toBeNull();
  });
});
