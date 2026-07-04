import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Entity } from '@/core/api/models';

import { MarkdownView } from './markdown-view';

function makeEntity(name: string, description: string | null): Entity {
  return {
    id: 1,
    campaign_id: 1,
    name,
    group_id: null,
    description,
    created_at: '',
    updated_at: '',
  };
}

describe('MarkdownView entity mentions', () => {
  let navigateByUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigateByUrl = vi.fn();
    TestBed.configureTestingModule({
      imports: [MarkdownView],
      providers: [{ provide: Router, useValue: { navigateByUrl } }],
    });
  });

  it('renders @[Name] as an entity-mention link to search', () => {
    const fixture = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('source', 'Meet @[Gandalf] today.');
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.entity-mention') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/search?q=Gandalf');
    expect(link.textContent).toContain('Gandalf');
    expect(fixture.nativeElement.textContent).not.toContain('@[');
  });

  it('navigates via the router and prevents the default full load on click', () => {
    const fixture = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('source', 'Meet @[The Balrog].');
    fixture.detectChanges();

    // Click the innermost element (the <em> holding the text), as a real user would.
    const target = fixture.nativeElement.querySelector('a.entity-mention em') as HTMLElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    const notPrevented = target.dispatchEvent(event);

    expect(navigateByUrl).toHaveBeenCalledWith('/search?q=The%20Balrog');
    expect(notPrevented).toBe(false); // preventDefault was called → no browser navigation
  });

  it('shows a markdown tooltip titled with the entity name on hover', () => {
    const fixture = TestBed.createComponent(MarkdownView);
    // A lower-case mention resolves to the entity's canonical name in the title.
    fixture.componentRef.setInput('source', 'Meet @[gandalf].');
    fixture.componentRef.setInput('entities', [makeEntity('Gandalf', 'A **wandering** wizard.')]);
    fixture.detectChanges();

    const target = fixture.nativeElement.querySelector('a.entity-mention em') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.entity-tooltip-name');
    expect(name?.textContent?.trim()).toBe('Gandalf'); // canonical casing, not the mention's

    const body = fixture.nativeElement.querySelector('.entity-tooltip-body');
    expect(body?.querySelector('strong')?.textContent).toBe('wandering'); // markdown rendered
    expect(body?.textContent).toContain('wizard.');
  });

  it('shows no tooltip when the entity has no description', () => {
    const fixture = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('source', 'Meet @[Gandalf].');
    fixture.componentRef.setInput('entities', [makeEntity('Gandalf', null)]);
    fixture.detectChanges();

    const target = fixture.nativeElement.querySelector('a.entity-mention em') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.entity-tooltip')).toBeNull();
  });

  it('hides the tooltip when the pointer leaves the mention', () => {
    const fixture = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('source', 'Meet @[Gandalf].');
    fixture.componentRef.setInput('entities', [makeEntity('Gandalf', 'A wizard.')]);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.entity-mention') as HTMLElement;
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.entity-tooltip')).not.toBeNull();

    // Leave to something outside the mention.
    link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.entity-tooltip')).toBeNull();
  });
});
