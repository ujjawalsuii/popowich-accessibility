/**
 * ScreenShield color palettes for accessibility.
 * Used by the popup (and optionally by extension-injected UI).
 * Each palette defines high-contrast, distinguishable colors.
 *
 * Keys map to CSS variables: --bg, --surface, --text, --accent, etc.
 */

const PALETTES = {
  default: {
    background: '#0f0f1a',
    surface: '#1a1a2e',
    surface2: '#22223b',
    border: '#2d2d4a',
    text: '#e8e8f0',
    textMuted: '#8888aa',
    textPrimary: '#e8e8f0',
    textSecondary: '#8888aa',
    accent: '#4a90d9',
    accentDim: 'rgba(74, 144, 217, 0.15)',
    success: '#34c759',
    warning: '#f5a623',
    error: '#e74c3c',
    tts: '#a855f7',
    ttsDim: 'rgba(168, 85, 247, 0.15)',
  },

  // Deuteranopia: red–green confusion. Use blue accent, amber warning, cyan/teal success, magenta error.
  deuteranopia: {
    background: '#0f1419',
    surface: '#1a2332',
    surface2: '#1e2a3d',
    border: '#2d3a4f',
    text: '#e6edf3',
    textMuted: '#7d8fa3',
    textPrimary: '#e6edf3',
    textSecondary: '#7d8fa3',
    accent: '#58a6ff',
    accentDim: 'rgba(88, 166, 255, 0.15)',
    success: '#39c5cf',
    warning: '#d4a72c',
    error: '#f778ba',
    tts: '#a371f7',
    ttsDim: 'rgba(163, 113, 247, 0.15)',
  },

  // Protanopia: red–green confusion (similar strategy to deuteranopia).
  protanopia: {
    background: '#13111c',
    surface: '#1c1a28',
    surface2: '#252235',
    border: '#36334a',
    text: '#e8e6f0',
    textMuted: '#8a8799',
    textPrimary: '#e8e6f0',
    textSecondary: '#8a8799',
    accent: '#6b9fff',
    accentDim: 'rgba(107, 159, 255, 0.15)',
    success: '#2eb39a',
    warning: '#e5b822',
    error: '#e85d8a',
    tts: '#b87fff',
    ttsDim: 'rgba(184, 127, 255, 0.15)',
  },

  // Tritanopia: blue–yellow confusion. Use red/orange accent, green success; avoid blue–yellow pairing.
  tritanopia: {
    background: '#1a0f0f',
    surface: '#2e1a1a',
    surface2: '#3d2222',
    border: '#4a2d2d',
    text: '#f0e8e8',
    textMuted: '#aa8888',
    textPrimary: '#f0e8e8',
    textSecondary: '#aa8888',
    accent: '#e5534b',
    accentDim: 'rgba(229, 83, 75, 0.15)',
    success: '#26a269',
    warning: '#daaa3b',
    error: '#c01c28',
    tts: '#c678dd',
    ttsDim: 'rgba(198, 120, 221, 0.15)',
  },
};

/**
 * Apply a palette to a DOM element (e.g. document.documentElement) by setting CSS custom properties.
 * @param {string} mode - One of: 'default', 'deuteranopia', 'protanopia', 'tritanopia'
 * @param {HTMLElement} [root=document.documentElement] - Element to set variables on
 */
function applyPalette(mode, root = document.documentElement) {
  const palette = PALETTES[mode] || PALETTES.default;
  if (!root || !root.style) return;

  root.style.setProperty('--bg', palette.background);
  root.style.setProperty('--surface', palette.surface);
  root.style.setProperty('--surface-2', palette.surface2);
  root.style.setProperty('--border', palette.border);
  root.style.setProperty('--text', palette.text);
  root.style.setProperty('--text-muted', palette.textMuted);
  root.style.setProperty('--text-primary', palette.textPrimary);
  root.style.setProperty('--text-secondary', palette.textSecondary);
  root.style.setProperty('--accent', palette.accent);
  root.style.setProperty('--accent-dim', palette.accentDim);
  root.style.setProperty('--on', palette.success);
  root.style.setProperty('--warn', palette.warning);
  root.style.setProperty('--error', palette.error);
  root.style.setProperty('--tts', palette.tts);
  root.style.setProperty('--tts-dim', palette.ttsDim);
}

/**
 * Return a CSS string that sets palette variables on :host (for Shadow DOM).
 * Use this in content script when building extension-injected UI.
 * @param {string} mode - One of: 'default', 'deuteranopia', 'protanopia', 'tritanopia'
 * @returns {string} CSS string to prepend to shadow styles
 */
function getPaletteCSS(mode) {
  const palette = PALETTES[mode] || PALETTES.default;
  return `:host {
  --bg: ${palette.background};
  --surface: ${palette.surface};
  --surface-2: ${palette.surface2};
  --border: ${palette.border};
  --text: ${palette.text};
  --text-muted: ${palette.textMuted};
  --accent: ${palette.accent};
  --accent-dim: ${palette.accentDim};
  --on: ${palette.success};
  --warn: ${palette.warning};
  --error: ${palette.error};
  --tts: ${palette.tts};
  --tts-dim: ${palette.ttsDim};
}`;
}

// Export for use in popup and content script
typeof window !== 'undefined' && (window.PALETTES = PALETTES);
typeof window !== 'undefined' && (window.applyPalette = applyPalette);
typeof window !== 'undefined' && (window.getPaletteCSS = getPaletteCSS);
