export const AppTheme = {
  colors: {
    background: '#f4f7fc',
    /** The top header strip and the bottom tab bar, which are themed together. */
    bar: '#ffffff',
    surface: '#ffffff',
    surfaceSubtle: '#f8fafc',
    primary: '#0078D4', // Vibrant cloud blue matching OneDrive image
    primaryHover: '#0067b8',
    primaryLight: '#eef6fc', // Soft cloud blue tint for badges and buttons
    primaryBorder: '#cce4f7',
    text: '#0f172a', // Deep slate bold text
    textSecondary: '#64748b', // Muted text
    textMuted: '#94a3b8',
    error: '#ef4444', // Red for delete action
    errorLight: '#fee2e2', // Light red background for delete button
    border: '#e2e8f0',
    sensitive: '#f59e0b',
    cardBackground: '#ffffff',
    cardBorder: '#f1f5f9',
    iconFolderBg: '#e1effa',
  },
  spacing: {
    xs: 4,
    s: 8,
    m: 16,
    l: 24,
    xl: 32,
  },
  borderRadius: {
    xs: 6,
    s: 10,
    m: 14,
    l: 20,
    xl: 24,
    pill: 9999,
  },
  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.03,
      shadowRadius: 12,
      elevation: 2,
    },
    fab: {
      shadowColor: '#0078D4',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
      elevation: 6,
    },
    modal: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 8,
    }
  }
};


/**
 * The accent is the one colour the app is built around: buttons, icons, the
 * FAB, selected states, badges and highlights all come from it. Only these five
 * entries change between themes - every other colour is a neutral that works
 * under any of them.
 */
export interface Accent {
  key: string;
  label: string;
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryBorder: string;
  iconFolderBg: string;
}

export const ACCENTS: Accent[] = [
  {
    key: 'blue',
    label: 'Ocean',
    primary: '#0078D4',
    primaryHover: '#0067b8',
    primaryLight: '#eef6fc',
    primaryBorder: '#cce4f7',
    iconFolderBg: '#e1effa',
  },
  {
    key: 'teal',
    label: 'Lagoon',
    primary: '#0d9488',
    primaryHover: '#0f766e',
    primaryLight: '#effcfa',
    primaryBorder: '#c3ece6',
    iconFolderBg: '#d9f3ef',
  },
  {
    key: 'green',
    label: 'Forest',
    primary: '#16a34a',
    primaryHover: '#15803d',
    primaryLight: '#f0fdf4',
    primaryBorder: '#c6ead2',
    iconFolderBg: '#dcf3e4',
  },
  {
    key: 'purple',
    label: 'Violet',
    primary: '#7c3aed',
    primaryHover: '#6d28d9',
    primaryLight: '#f5f1fe',
    primaryBorder: '#ddd0fb',
    iconFolderBg: '#eae2fd',
  },
  {
    key: 'rose',
    label: 'Rose',
    primary: '#e11d48',
    primaryHover: '#be123c',
    primaryLight: '#fff1f4',
    primaryBorder: '#fbcdd7',
    iconFolderBg: '#fde0e6',
  },
  {
    key: 'amber',
    label: 'Amber',
    primary: '#d97706',
    primaryHover: '#b45309',
    primaryLight: '#fff8ed',
    primaryBorder: '#f6ddb8',
    iconFolderBg: '#fbecd3',
  },
  {
    key: 'slate',
    label: 'Graphite',
    primary: '#475569',
    primaryHover: '#334155',
    primaryLight: '#f4f6f9',
    primaryBorder: '#d8dee7',
    iconFolderBg: '#e6eaf0',
  },
];

export const DEFAULT_ACCENT_KEY = 'blue';

/** The key that means "whatever colour the user mixed for themselves". */
export const CUSTOM_KEY = 'custom';

/** Where the custom pickers start before anyone has chosen anything. */
export const DEFAULT_CUSTOM_ACCENT = '#0f9d8f';
export const DEFAULT_CUSTOM_PAPER = '#fdf1e7';

// --- colour maths -----------------------------------------------------------
// A custom accent is one colour, but the app needs four shades of it: the fill,
// a darker press state, a pale tint for badges and a border between the two.
// They are worked out in HSL, where "the same colour but paler" is one number.

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
  const clean = (hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  if ([r, g, b].some(v => isNaN(v))) return { h: 200, s: 70, l: 45 };

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

export const hslToHex = (h: number, s: number, l: number): string => {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

/** True for a value this app can treat as a colour rather than a preset name. */
export const isHexColor = (value: string): boolean => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || '');

export const deriveAccent = (hex: string): Accent => {
  const { h, s, l } = hexToHsl(hex);
  return {
    key: CUSTOM_KEY,
    label: 'Custom',
    primary: hslToHex(h, s, l),
    primaryHover: hslToHex(h, s, clamp(l - 9, 8, 92)),
    // The tints hold the hue but drop most of the colour, so text stays readable
    primaryLight: hslToHex(h, Math.min(s, 60), 96),
    primaryBorder: hslToHex(h, Math.min(s, 55), 86),
    iconFolderBg: hslToHex(h, Math.min(s, 55), 91),
  };
};

export const getAccent = (key: string, customHex?: string): Accent => {
  if (key === CUSTOM_KEY) return deriveAccent(customHex || DEFAULT_CUSTOM_ACCENT);
  return ACCENTS.find(a => a.key === key) || ACCENTS[0];
};

/**
 * Repaints the theme in place.
 *
 * Every screen reads `AppTheme.colors.*` directly - some four hundred times -
 * so swapping the values here is what makes one tap recolour the whole app.
 * Nothing re-renders on its own as a result, which is why the accent is also
 * kept in the store: components read that, so a change to it brings them back
 * through render, where they pick these values up. Styles built once by
 * StyleSheet.create are rebuilt from the same signal.
 */
export const applyAccent = (key: string, customHex?: string): Accent => {
  const accent = getAccent(key, customHex);
  AppTheme.colors.primary = accent.primary;
  AppTheme.colors.primaryHover = accent.primaryHover;
  AppTheme.colors.primaryLight = accent.primaryLight;
  AppTheme.colors.primaryBorder = accent.primaryBorder;
  AppTheme.colors.iconFolderBg = accent.iconFolderBg;
  AppTheme.shadows.fab.shadowColor = accent.primary;
  return accent;
};

/**
 * What the app itself is laid out on, behind the white cards.
 */
export interface Background {
  key: string;
  label: string;
  color: string;
}

export const BACKGROUNDS: Background[] = [
  { key: 'cloud', label: 'Cloud', color: '#f4f7fc' },
  { key: 'white', label: 'White', color: '#ffffff' },
  { key: 'paper', label: 'Paper', color: '#faf7f1' },
  { key: 'mist', label: 'Mist', color: '#f1f6f3' },
  { key: 'sky', label: 'Sky', color: '#eff5fc' },
  { key: 'lilac', label: 'Lilac', color: '#f5f2fb' },
  { key: 'blush', label: 'Blush', color: '#fdf2f4' },
  { key: 'stone', label: 'Stone', color: '#eef0f4' },
];

export const DEFAULT_BACKGROUND_KEY = 'cloud';
export const DEFAULT_CUSTOM_BACKGROUND = '#eaf2ea';

/**
 * Held above this lightness whatever is chosen. The cards are white and the
 * writing on them is near-black, so a genuinely dark background would leave
 * labels unreadable rather than looking dark - that is a different job.
 */
const BACKGROUND_MIN_LIGHTNESS = 70;

export const readableBackground = (hex: string): string => {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.min(s, 70), Math.max(l, BACKGROUND_MIN_LIGHTNESS));
};

export const getBackground = (key: string, customHex?: string): Background => {
  if (key === CUSTOM_KEY) {
    return { key: CUSTOM_KEY, label: 'Custom', color: readableBackground(customHex || DEFAULT_CUSTOM_BACKGROUND) };
  }
  return BACKGROUNDS.find(b => b.key === key) || BACKGROUNDS[0];
};

/** Repaints what the app is laid out on, the same way applyAccent does. */
export const applyBackground = (key: string, customHex?: string): Background => {
  const background = getBackground(key, customHex);
  AppTheme.colors.background = background.color;
  return background;
};

/**
 * The two strips that frame the app: the header along the top and the tab bar
 * along the bottom. They carry small text and icons, so they are kept paler
 * than the background is.
 */
export const BAR_COLORS: Background[] = [
  { key: 'white', label: 'White', color: '#ffffff' },
  { key: 'cloud', label: 'Cloud', color: '#f6f9fd' },
  { key: 'paper', label: 'Paper', color: '#fbf8f3' },
  { key: 'mist', label: 'Mist', color: '#f4f9f6' },
  { key: 'sky', label: 'Sky', color: '#f2f7fd' },
  { key: 'lilac', label: 'Lilac', color: '#f7f4fc' },
  { key: 'blush', label: 'Blush', color: '#fef5f7' },
  { key: 'stone', label: 'Stone', color: '#f1f3f7' },
];

export const DEFAULT_BAR_KEY = 'white';
export const DEFAULT_CUSTOM_BAR = '#eef4fb';

/** Paler still than a background: the bars hold the smallest text in the app. */
const BAR_MIN_LIGHTNESS = 80;

export const readableBar = (hex: string): string => {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.min(s, 60), Math.max(l, BAR_MIN_LIGHTNESS));
};

export const getBar = (key: string, customHex?: string): Background => {
  if (key === CUSTOM_KEY) {
    return { key: CUSTOM_KEY, label: 'Custom', color: readableBar(customHex || DEFAULT_CUSTOM_BAR) };
  }
  return BAR_COLORS.find(b => b.key === key) || BAR_COLORS[0];
};

export const applyBars = (key: string, customHex?: string): Background => {
  const bar = getBar(key, customHex);
  AppTheme.colors.bar = bar.color;
  return bar;
};

/**
 * The paper a diary page or a note is written on. Kept deliberately pale: text
 * on these has to stay readable, and they sit behind ruled lines.
 */
export interface PageColor {
  key: string;
  label: string;
  /** The sheet itself. */
  paper: string;
  /** The ruled lines and the sheet border, which have to stay just visible. */
  rule: string;
}

export const PAGE_COLORS: PageColor[] = [
  { key: 'cream', label: 'Cream', paper: '#fffdf7', rule: '#e6e0d0' },
  { key: 'white', label: 'White', paper: '#ffffff', rule: '#e2e8f0' },
  { key: 'sand', label: 'Sand', paper: '#fdf6e9', rule: '#e8dcc2' },
  { key: 'mint', label: 'Mint', paper: '#f1faf4', rule: '#cfe6d7' },
  { key: 'sky', label: 'Sky', paper: '#f1f7fd', rule: '#cfe0f0' },
  { key: 'lilac', label: 'Lilac', paper: '#f6f3fd', rule: '#ddd4f0' },
  { key: 'blush', label: 'Blush', paper: '#fdf3f5', rule: '#f0d5dc' },
  { key: 'graphite', label: 'Graphite', paper: '#eef1f5', rule: '#d3dae3' },
];

export const DEFAULT_PAGE_COLOR_KEY = 'cream';

/**
 * A custom paper only needs its ruled lines working out: a shade of the same
 * colour, dark enough to see and pale enough to write over.
 */
export const derivePageColor = (hex: string): PageColor => {
  const { h, s, l } = hexToHsl(hex);
  return {
    key: CUSTOM_KEY,
    label: 'Custom',
    paper: hslToHex(h, s, l),
    rule: hslToHex(h, Math.min(s + 8, 45), clamp(l - 12, 0, 88)),
  };
};

export const getPageColor = (key: string, customHex?: string): PageColor => {
  if (key === CUSTOM_KEY) return derivePageColor(customHex || DEFAULT_CUSTOM_PAPER);
  return PAGE_COLORS.find(c => c.key === key) || PAGE_COLORS[0];
};

/**
 * A note's own paper. Stored as a preset key, or as the hex a custom paper was
 * mixed to. Notes saved before papers were per note have none, and keep the
 * paper that used to be shared by every note.
 */
export const resolveNotePageColor = (value: string | null | undefined, fallback: PageColor): PageColor => {
  if (!value) return fallback;
  if (isHexColor(value)) return derivePageColor(value);
  return PAGE_COLORS.find(c => c.key === value) || fallback;
};

/** The colour a note's card wears in the list, set alongside its name. */
export interface NoteTabColor {
  key: string;
  label: string;
  /** The card's fill. */
  card: string;
  /** The card's border. */
  border: string;
  /** The stripe down the card's edge and the swatch in the picker. */
  accent: string;
}

export const NOTE_TAB_COLORS: NoteTabColor[] = [
  { key: 'default', label: 'Plain', card: '#ffffff', border: '#e2e8f0', accent: '#cbd5e1' },
  { key: 'red', label: 'Red', card: '#fef2f2', border: '#fecaca', accent: '#ef4444' },
  { key: 'orange', label: 'Orange', card: '#fff7ed', border: '#fed7aa', accent: '#f97316' },
  { key: 'yellow', label: 'Yellow', card: '#fefce8', border: '#fde68a', accent: '#eab308' },
  { key: 'green', label: 'Green', card: '#f0fdf4', border: '#bbf7d0', accent: '#22c55e' },
  { key: 'teal', label: 'Teal', card: '#f0fdfa', border: '#99f6e4', accent: '#14b8a6' },
  { key: 'blue', label: 'Blue', card: '#eff6ff', border: '#bfdbfe', accent: '#3b82f6' },
  { key: 'purple', label: 'Purple', card: '#faf5ff', border: '#e9d5ff', accent: '#a855f7' },
  { key: 'pink', label: 'Pink', card: '#fdf2f8', border: '#fbcfe8', accent: '#ec4899' },
];

export const DEFAULT_NOTE_TAB_COLOR_KEY = 'default';
export const DEFAULT_CUSTOM_NOTE_TAB = '#0ea5e9';

/** A custom card: the mixed colour as the stripe, with a pale wash of it behind. */
export const deriveNoteTabColor = (hex: string): NoteTabColor => {
  const { h, s, l } = hexToHsl(hex);
  return {
    key: CUSTOM_KEY,
    label: 'Custom',
    card: hslToHex(h, Math.min(s, 80), 96),
    border: hslToHex(h, Math.min(s, 70), 84),
    accent: hslToHex(h, s, l),
  };
};

/** Stored as a preset key or a custom hex, as note papers are. */
export const resolveNoteTabColor = (value: string | null | undefined): NoteTabColor => {
  if (value && isHexColor(value)) return deriveNoteTabColor(value);
  return NOTE_TAB_COLORS.find(c => c.key === value) || NOTE_TAB_COLORS[0];
};
