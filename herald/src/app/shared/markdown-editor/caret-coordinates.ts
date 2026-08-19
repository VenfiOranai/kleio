/**
 * Pixel coordinates of the caret within a <textarea>, so an overlay can be anchored to it.
 * Uses the well-known "mirror div" technique: a hidden div is styled like the textarea and
 * filled with the text up to the caret, then a marker span's offset is measured.
 */

// Style properties that affect text layout and must be copied onto the mirror.
const MIRRORED_PROPERTIES = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'wordSpacing',
  'tabSize',
] as const;

export interface CaretCoordinates {
  top: number;
  left: number;
  height: number;
}

export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretCoordinates {
  const doc = textarea.ownerDocument;
  const mirror = doc.createElement('div');
  const style = mirror.style;
  const computed = getComputedStyle(textarea);

  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.overflow = 'hidden';
  for (const prop of MIRRORED_PROPERTIES) {
    style[prop] = computed[prop];
  }

  mirror.textContent = textarea.value.substring(0, position);
  const marker = doc.createElement('span');
  // A non-empty marker so it has a measurable box even at end-of-text.
  marker.textContent = textarea.value.substring(position) || '.';
  mirror.appendChild(marker);

  doc.body.appendChild(mirror);
  const coordinates: CaretCoordinates = {
    top: marker.offsetTop + parseInt(computed.borderTopWidth, 10),
    left: marker.offsetLeft + parseInt(computed.borderLeftWidth, 10),
    height: parseInt(computed.lineHeight, 10) || marker.offsetHeight,
  };
  doc.body.removeChild(mirror);
  return coordinates;
}
