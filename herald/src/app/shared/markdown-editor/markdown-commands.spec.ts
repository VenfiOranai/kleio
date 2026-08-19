import { describe, expect, it } from 'vitest';

import { EditorState, MarkdownCommand, applyCommand } from './markdown-commands';

/**
 * Cases are written as one string with `‸` marking the caret and `‹…›` marking a selection, so
 * the expected text and the expected selection read as a single line. The markers are chosen to
 * never collide with Markdown itself (`[`, `]` and `|` all appear in the fixtures).
 */
const CARET = '‸';
const OPEN = '‹';
const CLOSE = '›';

function parse(marked: string): EditorState {
  const caret = marked.indexOf(CARET);
  if (caret !== -1) {
    const value = marked.slice(0, caret) + marked.slice(caret + 1);
    return { value, selectionStart: caret, selectionEnd: caret };
  }
  const start = marked.indexOf(OPEN);
  const end = marked.indexOf(CLOSE);
  const value = marked.slice(0, start) + marked.slice(start + 1, end) + marked.slice(end + 1);
  return { value, selectionStart: start, selectionEnd: end - 1 };
}

function format(state: EditorState): string {
  const { value, selectionStart: start, selectionEnd: end } = state;
  if (start === end) return value.slice(0, start) + CARET + value.slice(start);
  return value.slice(0, start) + OPEN + value.slice(start, end) + CLOSE + value.slice(end);
}

function run(input: string, command: MarkdownCommand): string {
  return format(applyCommand(parse(input), command));
}

describe('inline wrapping', () => {
  it('wraps a selection and keeps the text selected', () => {
    expect(run('say ‹hello› there', 'bold')).toBe('say **‹hello›** there');
    expect(run('say ‹hello› there', 'italic')).toBe('say *‹hello›* there');
    expect(run('say ‹hello› there', 'strikethrough')).toBe('say ~~‹hello›~~ there');
    expect(run('say ‹hello› there', 'code')).toBe('say `‹hello›` there');
  });

  it('inserts a selected placeholder when nothing is selected', () => {
    expect(run('say ‸', 'bold')).toBe('say **‹bold text›**');
    expect(run('say ‸', 'code')).toBe('say `‹code›`');
  });

  it('unwraps when the markers sit just outside the selection', () => {
    expect(run('say **‹hello›** there', 'bold')).toBe('say ‹hello› there');
    expect(run('say ~~‹hello›~~ there', 'strikethrough')).toBe('say ‹hello› there');
    expect(run('say *‹hello›* there', 'italic')).toBe('say ‹hello› there');
  });

  it('unwraps when the selection covers the markers', () => {
    expect(run('say ‹**hello**› there', 'bold')).toBe('say ‹hello› there');
  });

  it('nests italic inside bold rather than eating one asterisk', () => {
    expect(run('say **‹hello›** there', 'italic')).toBe('say ***‹hello›*** there');
    expect(run('say ‹**hello**› there', 'italic')).toBe('say *‹**hello**›* there');
  });
});

describe('headings', () => {
  it('adds the marker to the caret line', () => {
    expect(run('Goblin am‸bush', 'h2')).toBe('## Goblin am‸bush');
  });

  it('replaces an existing heading level instead of stacking', () => {
    expect(run('## Goblin‸ ambush', 'h1')).toBe('# Goblin‸ ambush');
  });

  it('toggles the same level back off', () => {
    expect(run('## Goblin‸ ambush', 'h2')).toBe('Goblin‸ ambush');
  });

  it('applies to every selected line', () => {
    expect(run('‹one\ntwo›', 'h3')).toBe('‹### one\n### two›');
  });
});

describe('lists and quotes', () => {
  it('bullets or numbers each selected line', () => {
    expect(run('‹one\ntwo\nthree›', 'ul')).toBe('‹- one\n- two\n- three›');
    expect(run('‹one\ntwo\nthree›', 'ol')).toBe('‹1. one\n2. two\n3. three›');
  });

  it('switches between list styles instead of stacking markers', () => {
    expect(run('‹- one\n- two›', 'ol')).toBe('‹1. one\n2. two›');
    expect(run('‹1. one\n2. two›', 'ul')).toBe('‹- one\n- two›');
    expect(run('‹- one\n- two›', 'task')).toBe('‹- [ ] one\n- [ ] two›');
  });

  it('toggles a list off when every line already has it', () => {
    expect(run('‹- one\n- two›', 'ul')).toBe('‹one\ntwo›');
    expect(run('‹1. one\n2. two›', 'ol')).toBe('‹one\ntwo›');
    expect(run('‹- [ ] one\n- [x] two›', 'task')).toBe('‹one\ntwo›');
  });

  it('treats a task item as a task, not a bullet, when toggling bullets', () => {
    expect(run('‹- [ ] one›', 'ul')).toBe('‹- one›');
  });

  it('quotes lines without stacking on already-quoted ones', () => {
    expect(run('‹one\n> two›', 'quote')).toBe('‹> one\n> two›');
    expect(run('‹> one\n> two›', 'quote')).toBe('‹one\ntwo›');
  });

  it('leaves blank lines inside a multi-line selection alone', () => {
    expect(run('‹one\n\ntwo›', 'ul')).toBe('‹- one\n\n- two›');
  });

  it('keeps the caret the same distance from the end of its line', () => {
    expect(run('one‸two', 'ul')).toBe('- one‸two');
    expect(run('- one‸two', 'ul')).toBe('one‸two');
  });
});

describe('block inserts', () => {
  it('inserts a table with the first header cell selected', () => {
    expect(run('‸', 'table')).toBe('| ‹Column› | Column |\n| --- | --- |\n|  |  |\n');
  });

  it('pushes a block onto its own line when the caret line has text', () => {
    expect(run('notes‸', 'rule')).toBe('notes\n\n---\n‸');
  });

  it('lands after the current line rather than overwriting a selection', () => {
    expect(run('the ‹goblin› king', 'table')).toBe(
      'the goblin king\n\n| ‹Column› | Column |\n| --- | --- |\n|  |  |\n',
    );
    expect(run('one‸\ntwo', 'rule')).toBe('one\n\n---\n‸\ntwo');
  });

  it('fences the selection, or a placeholder, as a code block', () => {
    expect(run('‹roll 2d6›', 'codeBlock')).toBe('```\n‹roll 2d6›\n```\n');
    expect(run('‸', 'codeBlock')).toBe('```\n‹code›\n```\n');
  });
});

describe('links', () => {
  it('uses the selection as the label and selects the url to type', () => {
    expect(run('see ‹the map› now', 'link')).toBe('see [the map](‹https://›) now');
  });

  it('detects a selected url and selects the label instead', () => {
    expect(run('see ‹https://example.com› now', 'link')).toBe(
      'see [‹link text›](https://example.com) now',
    );
  });

  it('inserts a full placeholder when nothing is selected', () => {
    expect(run('see ‸', 'link')).toBe('see [link text](‹https://›)');
  });
});
