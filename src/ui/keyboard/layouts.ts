export type KeyAction =
  | 'backspace'
  | 'enter'
  | 'tab'
  | 'space'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'shift'
  | 'toggleLayer'
  | 'systemKeyboard';

export interface Key {
  label: string;
  /** Text inserted when tapped. */
  text?: string;
  /** Replaces `text` and `label` while shift is on. */
  shift?: string;
  action?: KeyAction;
  /** Share of the row's width. Defaults to 1. */
  flex?: number;
  variant?: 'accent' | 'muted';
}

export type LayerId = 'letters' | 'symbols';

export interface Layer {
  id: LayerId;
  rows: Key[][];
}

const char = (value: string, shift?: string): Key => ({ label: value, text: value, shift });

const BACKSPACE: Key = { label: '⌫', action: 'backspace', variant: 'muted' };
const ENTER: Key = { label: '↵', action: 'enter', variant: 'accent' };

/**
 * The bottom row is identical across layers so its keys stay where your thumb
 * expects them: layer switch, hand-off to the OS keyboard, tab, space, arrows.
 */
function bottomRow(layerLabel: string): Key[] {
  return [
    { label: layerLabel, action: 'toggleLayer', flex: 1.5, variant: 'muted' },
    { label: '⌨', action: 'systemKeyboard', variant: 'muted' },
    { label: 'Tab', action: 'tab', flex: 1.3, variant: 'muted' },
    { label: 'space', action: 'space', flex: 3.4 },
    { label: '←', action: 'left', variant: 'muted' },
    { label: '↓', action: 'down', variant: 'muted' },
    { label: '↑', action: 'up', variant: 'muted' },
    { label: '→', action: 'right', variant: 'muted' },
  ];
}

/**
 * Letters, with the digit row always present.
 *
 * Phone keyboards bury digits behind a layer switch, which is tolerable for
 * prose and miserable for code — array indices, ports, versions and constants
 * are everywhere. Here they cost nothing.
 */
const letters: Layer = {
  id: 'letters',
  rows: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((v) => char(v)),
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'].map((v) => char(v, v.toUpperCase())),
    [
      ...['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'].map((v) => char(v, v.toUpperCase())),
      BACKSPACE,
    ],
    [
      { label: '⇧', action: 'shift', variant: 'muted' },
      ...['z', 'x', 'c', 'v', 'b', 'n', 'm'].map((v) => char(v, v.toUpperCase())),
      char('.'),
      ENTER,
    ],
    bottomRow('#+='),
  ],
};

/**
 * Symbols, ordered by what code actually needs rather than by ASCII.
 *
 * Brackets and quotes get the top row because they are the most-reached-for
 * characters in every language here; operators get the second. The last row is
 * multi-character sequences — `=>`, `::`, `!=` — which are the sequences you
 * would otherwise type one awkward key at a time.
 */
const symbols: Layer = {
  id: 'symbols',
  rows: [
    ['(', ')', '{', '}', '[', ']', '<', '>', '"', "'"].map((v) => char(v)),
    ['=', '+', '-', '*', '/', '%', '!', '&', '|', '^'].map((v) => char(v)),
    [...[';', ':', ',', '.', '?', '_', '#', '@', '$'].map((v) => char(v)), BACKSPACE],
    [
      ...['~', '`', '\\'].map((v) => char(v)),
      { label: '->', text: '->' },
      { label: '=>', text: '=>' },
      { label: '::', text: '::' },
      { label: '!=', text: '!=' },
      { label: '==', text: '==' },
      ENTER,
    ],
    bottomRow('ABC'),
  ],
};

export const LAYERS: Record<LayerId, Layer> = { letters, symbols };
