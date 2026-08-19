/**
 * The text transforms behind the markdown editor's toolbar.
 *
 * Every command is a **pure** function of the textarea's value + selection (same rule as
 * `character_calc`, `spell-slots` and `features`): no DOM, no component state, so the fiddly
 * "wrap / unwrap / renumber" logic is exhaustively unit-testable and the component only has to
 * write the result back and restore the selection.
 */

export interface EditorState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type MarkdownCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'task'
  | 'link'
  | 'codeBlock'
  | 'table'
  | 'rule';

/** Inline commands: a marker repeated either side of the selection. */
const WRAPS = {
  bold: { marker: '**', placeholder: 'bold text' },
  italic: { marker: '*', placeholder: 'italic text' },
  strikethrough: { marker: '~~', placeholder: 'struck text' },
  code: { marker: '`', placeholder: 'code' },
} as const;

const HEADINGS = { h1: '# ', h2: '## ', h3: '### ' } as const;

const HEADING_RE = /^#{1,6} +/;
const QUOTE_RE = /^> ?/;
const TASK_RE = /^[-*+] +\[[ xX]\] +/;
const BULLET_RE = /^[-*+] +/;
const ORDERED_RE = /^\d+\. +/;
/** Any list marker, so switching between list styles replaces rather than stacks them. */
const ANY_LIST_RE = /^([-*+] +(\[[ xX]\] +)?|\d+\. +)/;

const TABLE_BLOCK = ['| Column | Column |', '| --- | --- |', '|  |  |'].join('\n');

/** Apply a toolbar command, returning the new value and the selection to restore. */
export function applyCommand(state: EditorState, command: MarkdownCommand): EditorState {
  switch (command) {
    case 'bold':
    case 'italic':
    case 'strikethrough':
    case 'code': {
      const { marker, placeholder } = WRAPS[command];
      return applyWrap(state, marker, placeholder);
    }
    case 'h1':
    case 'h2':
    case 'h3':
      return applyHeading(state, HEADINGS[command]);
    case 'quote':
      // Quotes stack on top of whatever else the line has, so they only strip themselves.
      return applyLinePrefix(state, '> ', (l) => QUOTE_RE.test(l), QUOTE_RE);
    case 'ul':
      // A bullet regex also matches a task item, so toggling off needs the stricter test.
      return applyLinePrefix(
        state,
        '- ',
        (l) => BULLET_RE.test(l) && !TASK_RE.test(l),
        ANY_LIST_RE,
      );
    case 'task':
      return applyLinePrefix(state, '- [ ] ', (l) => TASK_RE.test(l), ANY_LIST_RE);
    case 'ol':
      return applyOrderedList(state);
    case 'link':
      return applyLink(state);
    case 'codeBlock':
      return applyCodeBlock(state);
    case 'table':
      return insertBlock(state, TABLE_BLOCK, {
        offset: TABLE_BLOCK.indexOf('Column'),
        length: 'Column'.length,
      });
    case 'rule':
      return insertBlock(state, '---');
  }
}

// --- inline wrapping ---

function applyWrap(state: EditorState, marker: string, placeholder: string): EditorState {
  return (
    unwrapInside(state, marker) ??
    unwrapOutside(state, marker) ??
    wrapSelection(state, marker, placeholder)
  );
}

/**
 * `*` is a prefix of `**`, so an italic toggle must not chew one marker off bold text — it
 * should nest instead (`**bold**` → `***bold***`). Only the lone asterisk is ambiguous.
 */
function isBoldNeighbour(marker: string, left: string | undefined, right: string | undefined) {
  return marker === '*' && (left === '*' || right === '*');
}

/** Selection covers the markers too (`|**bold**|`) → drop them. */
function unwrapInside(state: EditorState, marker: string): EditorState | null {
  const { value, selectionStart: start, selectionEnd: end } = state;
  const selected = value.slice(start, end);
  if (selected.length < marker.length * 2) return null;
  if (!selected.startsWith(marker) || !selected.endsWith(marker)) return null;
  const inner = selected.slice(marker.length, selected.length - marker.length);
  if (isBoldNeighbour(marker, inner[0], inner[inner.length - 1])) return null;
  return {
    value: value.slice(0, start) + inner + value.slice(end),
    selectionStart: start,
    selectionEnd: start + inner.length,
  };
}

/** Markers sit just outside the selection (`**|bold|**`) → drop them. */
function unwrapOutside(state: EditorState, marker: string): EditorState | null {
  const { value, selectionStart: start, selectionEnd: end } = state;
  if (start < marker.length) return null;
  if (value.slice(start - marker.length, start) !== marker) return null;
  if (value.slice(end, end + marker.length) !== marker) return null;
  if (isBoldNeighbour(marker, value[start - marker.length - 1], value[end + marker.length])) {
    return null;
  }
  const from = start - marker.length;
  return {
    value: value.slice(0, from) + value.slice(start, end) + value.slice(end + marker.length),
    selectionStart: from,
    selectionEnd: from + (end - start),
  };
}

function wrapSelection(state: EditorState, marker: string, placeholder: string): EditorState {
  const { value, selectionStart: start, selectionEnd: end } = state;
  const text = start === end ? placeholder : value.slice(start, end);
  return {
    value: value.slice(0, start) + marker + text + marker + value.slice(end),
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + text.length,
  };
}

// --- line-level commands ---

/** The full lines touched by the selection — line commands always act on whole lines. */
function lineRange(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const next = value.indexOf('\n', end);
  return { from, to: next === -1 ? value.length : next };
}

/**
 * Replace the selected lines with `transform`'s output. A collapsed caret is restored by
 * anchoring to the *end* of the block, so the text after it stays put as prefixes change; a
 * real selection is re-spread over the whole rewritten block.
 */
function mapLines(state: EditorState, transform: (lines: string[]) => string[]): EditorState {
  const { value, selectionStart: start, selectionEnd: end } = state;
  const { from, to } = lineRange(value, start, end);
  const block = transform(value.slice(from, to).split('\n')).join('\n');
  const next = value.slice(0, from) + block + value.slice(to);
  if (start === end) {
    const caret = Math.max(from, from + block.length - (to - start));
    return { value: next, selectionStart: caret, selectionEnd: caret };
  }
  return { value: next, selectionStart: from, selectionEnd: from + block.length };
}

/** Blank lines never decide whether a prefix is "already applied" — nor do they receive one. */
function isBlank(line: string, lines: string[]): boolean {
  return line.trim() === '' && lines.length > 1;
}

/** True when every line with content already carries the prefix — i.e. the button is "on". */
function alreadyApplied(lines: string[], has: (line: string) => boolean): boolean {
  const content = lines.filter((line) => line.trim() !== '');
  return content.length > 0 && content.every(has);
}

function applyHeading(state: EditorState, prefix: string): EditorState {
  return mapLines(state, (lines) => {
    const on = alreadyApplied(lines, (line) => line.startsWith(prefix));
    return lines.map((line) => {
      if (isBlank(line, lines)) return line;
      const bare = line.replace(HEADING_RE, '');
      return on ? bare : prefix + bare;
    });
  });
}

/**
 * Toggle a line prefix over the selected lines. `has` decides whether a line already carries it;
 * `strip` is what gets removed — the whole family for lists (so bullets/numbers/tasks replace one
 * another rather than stacking), just itself for quotes.
 */
function applyLinePrefix(
  state: EditorState,
  prefix: string,
  has: (line: string) => boolean,
  strip: RegExp,
): EditorState {
  return mapLines(state, (lines) => {
    const on = alreadyApplied(lines, has);
    return lines.map((line) => {
      if (isBlank(line, lines)) return line;
      if (on) return line.replace(strip, '');
      if (has(line)) return line; // already there — don't double it up
      return prefix + (strip === QUOTE_RE ? line : line.replace(strip, ''));
    });
  });
}

function applyOrderedList(state: EditorState): EditorState {
  return mapLines(state, (lines) => {
    const on = alreadyApplied(lines, (line) => ORDERED_RE.test(line));
    let n = 0;
    return lines.map((line) => {
      if (isBlank(line, lines)) return line;
      if (on) return line.replace(ORDERED_RE, '');
      return `${++n}. ${line.replace(ANY_LIST_RE, '')}`;
    });
  });
}

// --- block inserts ---

/**
 * Drop `block` on a line of its own *after* the caret's line, with a blank line between them —
 * nothing already written is overwritten, so a table or rule can be added without losing the
 * selection. `select` optionally pre-selects a placeholder at that offset inside the block.
 */
function insertBlock(
  state: EditorState,
  block: string,
  select?: { offset: number; length: number },
): EditorState {
  const { value, selectionEnd: end } = state;
  const newline = value.indexOf('\n', end);
  const lineEnd = newline === -1 ? value.length : newline;
  const lineStart = value.lastIndexOf('\n', lineEnd - 1) + 1;
  const lead = value.slice(lineStart, lineEnd).trim() === '' ? '' : '\n\n';
  const rest = value.slice(lineEnd);
  const trail = rest === '' || rest.startsWith('\n') ? '\n' : '\n\n';
  const blockStart = lineEnd + lead.length;
  const next = value.slice(0, lineEnd) + lead + block + trail + rest;

  if (!select) {
    const caret = blockStart + block.length + trail.length;
    return { value: next, selectionStart: caret, selectionEnd: caret };
  }
  const at = blockStart + select.offset;
  return { value: next, selectionStart: at, selectionEnd: at + select.length };
}

/**
 * Unlike the other block inserts, this one *consumes* the selection: the selected text moves
 * inside the fences (that's the point of the button) rather than being pushed below them.
 */
function applyCodeBlock(state: EditorState): EditorState {
  const { value, selectionStart: start, selectionEnd: end } = state;
  const body = start === end ? 'code' : value.slice(start, end);
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lead = value.slice(lineStart, start).trim() === '' ? '' : '\n\n';
  const rest = value.slice(end);
  const trail = rest === '' || rest.startsWith('\n') ? '\n' : '\n\n';
  const at = start + lead.length + 4; // past the opening fence and its newline
  return {
    value: value.slice(0, start) + lead + '```\n' + body + '\n```' + trail + rest,
    selectionStart: at,
    selectionEnd: at + body.length,
  };
}

function applyLink(state: EditorState): EditorState {
  const { value, selectionStart: start, selectionEnd: end } = state;
  const selected = value.slice(start, end);
  const isUrl = /^(https?:\/\/|www\.|mailto:)\S*$/i.test(selected);
  const text = isUrl ? 'link text' : selected || 'link text';
  const url = isUrl ? selected : 'https://';
  const inserted = `[${text}](${url})`;
  // Select whichever half still needs typing: the label for a pasted URL, else the URL.
  const from = isUrl ? start + 1 : start + text.length + 3;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    selectionStart: from,
    selectionEnd: from + (isUrl ? text.length : url.length),
  };
}
