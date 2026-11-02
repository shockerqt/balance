// Accepted UDS-017 visual source3b801d9. Explicit role pairs, not seed approximations.
export const organicPalettes = {
  "forest": {
    "dark": {
      "roles": {
        "background": "#141e1b",
        "surface": "#1c2b25",
        "surfaceRaised": "#293a31",
        "text": "#edf3e9",
        "textSecondary": "#bdceba",
        "outline": "#8b9f88",
        "primary": "#c9e5ae",
        "onPrimary": "#233716",
        "secondary": "#344c38",
        "onSecondary": "#e1f0d9",
        "amber": "#efbd8a"
      },
      "header": [
        "#213c34",
        "#2c3d42",
        "#413745"
      ],
      "action": [
        "#bddfa2",
        "#a4d2bf",
        "#d6bbdf"
      ]
    },
    "light": {
      "roles": {
        "background": "#f4f5ef",
        "surface": "#e9eee3",
        "surfaceRaised": "#dfe8d8",
        "text": "#27352a",
        "textSecondary": "#506450",
        "outline": "#6a7d65",
        "primary": "#42633a",
        "onPrimary": "#ffffff",
        "secondary": "#dbeacb",
        "onSecondary": "#2c4125",
        "amber": "#83501e"
      },
      "header": [
        "#ddebcf",
        "#cce8e1",
        "#e9dcef"
      ],
      "action": [
        "#355a35",
        "#245e58",
        "#65475d"
      ]
    }
  },
  "lagoon": {
    "dark": {
      "roles": {
        "background": "#122026",
        "surface": "#1a2e35",
        "surfaceRaised": "#263e48",
        "text": "#e8f4f5",
        "textSecondary": "#b4cdd3",
        "outline": "#86a5af",
        "primary": "#a4dce0",
        "onPrimary": "#103a45",
        "secondary": "#284e59",
        "onSecondary": "#daf3f4",
        "amber": "#edbf89"
      },
      "header": [
        "#1b3c40",
        "#253c53",
        "#343c4e"
      ],
      "action": [
        "#9dd8cf",
        "#a9cee9",
        "#bbdce6"
      ]
    },
    "light": {
      "roles": {
        "background": "#eff7f7",
        "surface": "#e0eeef",
        "surfaceRaised": "#d0e4e8",
        "text": "#183d46",
        "textSecondary": "#41626b",
        "outline": "#66838c",
        "primary": "#146477",
        "onPrimary": "#ffffff",
        "secondary": "#c9e8e9",
        "onSecondary": "#17444c",
        "amber": "#83511c"
      },
      "header": [
        "#cce8e4",
        "#cce1f2",
        "#d8e8f2"
      ],
      "action": [
        "#165f68",
        "#275a83",
        "#3b6274"
      ]
    }
  },
  "lavender": {
    "dark": {
      "roles": {
        "background": "#201c2b",
        "surface": "#2a2438",
        "surfaceRaised": "#383047",
        "text": "#f3ecfa",
        "textSecondary": "#cdc0d8",
        "outline": "#a191b2",
        "primary": "#d7bff2",
        "onPrimary": "#392349",
        "secondary": "#4c365d",
        "onSecondary": "#f0defb",
        "amber": "#edbc92"
      },
      "header": [
        "#38304f",
        "#2e3a50",
        "#493346"
      ],
      "action": [
        "#d5b6ef",
        "#b9cef2",
        "#edbfd6"
      ]
    },
    "light": {
      "roles": {
        "background": "#f8f3fa",
        "surface": "#f0e8f5",
        "surfaceRaised": "#e6dcef",
        "text": "#32263f",
        "textSecondary": "#685374",
        "outline": "#85718f",
        "primary": "#76518a",
        "onPrimary": "#ffffff",
        "secondary": "#e8d7f2",
        "onSecondary": "#4a2e5d",
        "amber": "#88501c"
      },
      "header": [
        "#eadcf4",
        "#d9e4f5",
        "#f2dce8"
      ],
      "action": [
        "#6c4485",
        "#435b86",
        "#854c6d"
      ]
    }
  },
  "peach": {
    "dark": {
      "roles": {
        "background": "#261d20",
        "surface": "#33262a",
        "surfaceRaised": "#443339",
        "text": "#fbeded",
        "textSecondary": "#dfc0c3",
        "outline": "#b3949a",
        "primary": "#f2bdad",
        "onPrimary": "#49252d",
        "secondary": "#604047",
        "onSecondary": "#ffe5df",
        "amber": "#edc78b"
      },
      "header": [
        "#493235",
        "#403348",
        "#513c37"
      ],
      "action": [
        "#f0bd9f",
        "#edb3b9",
        "#d4bbe1"
      ]
    },
    "light": {
      "roles": {
        "background": "#fcf3ef",
        "surface": "#f6e7e2",
        "surfaceRaised": "#edd8d2",
        "text": "#4b2a31",
        "textSecondary": "#77545b",
        "outline": "#98747a",
        "primary": "#975155",
        "onPrimary": "#ffffff",
        "secondary": "#f0d4cf",
        "onSecondary": "#5e3039",
        "amber": "#825319"
      },
      "header": [
        "#f5dfc6",
        "#f2d5d8",
        "#e7dbed"
      ],
      "action": [
        "#91503d",
        "#8c4557",
        "#73527c"
      ]
    }
  }
} as const;
export type OrganicPalette = keyof typeof organicPalettes;
export type Appearance = 'system' | 'light' | 'dark';
export type ColorSource = 'system' | OrganicPalette;
export type ThemePreferences = { appearance: Appearance; colorSource: ColorSource };
export const defaultPreferences: ThemePreferences = { appearance: 'system', colorSource: 'system' };
export const paletteNames: Record<ColorSource, string> = { system: 'Sistema', forest: 'Bosque', lagoon: 'Laguna', lavender: 'Lavanda', peach: 'Durazno' };
export function parseThemePreferences(saved: string | null, legacy: string | null = null): ThemePreferences {
  try {
    const value = saved ? JSON.parse(saved) : null;
    if (value && ['system', 'light', 'dark'].includes(value.appearance) && Object.hasOwn(paletteNames, value.colorSource)) return { appearance: value.appearance, colorSource: value.colorSource };
  } catch { /* Invalid device preferences use the declared defaults. */ }
  if (legacy === 'libro' || legacy === 'libroNoche') return { appearance: legacy === 'libro' ? 'light' : 'dark', colorSource: 'forest' };
  return { ...defaultPreferences };
}
