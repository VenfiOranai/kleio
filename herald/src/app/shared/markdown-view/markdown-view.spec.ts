import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownView } from './markdown-view';

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
});
