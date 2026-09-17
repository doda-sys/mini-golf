/** Visual themes for the area around each hole (outside the playable green). */

export type HoleThemeId =
  | 'tropical'
  | 'desert'
  | 'arctic'
  | 'volcano'
  | 'neon'
  | 'pirate'
  | 'space'
  | 'autumn'
  | 'castle'
  | 'candy';

export type WallMaterial = 'wood' | 'stone' | 'brick' | 'metal' | 'ice' | 'candy';
export type BumperStyle = 'rubber' | 'metal' | 'candy';

export type HoleTheme = {
  id: HoleThemeId;
  label: string;
  /** Backdrop colors outside the green */
  outside: string;
  outsideAlt: string;
  accent: string;
  trim: string;
  wall: string;
  wallTop: string;
  wallEdge: string;
  wallMaterial: WallMaterial;
  bumperStyle: BumperStyle;
  decor: 'palms' | 'cacti' | 'snow' | 'lava' | 'grid' | 'waves' | 'stars' | 'leaves' | 'stones' | 'stripes';
};

export const THEMES: Record<HoleThemeId, HoleTheme> = {
  tropical: {
    id: 'tropical',
    label: 'Tropical',
    outside: '#0e5c4a',
    outsideAlt: '#0a4a3c',
    accent: '#ff6b9d',
    trim: '#f4d35e',
    wall: '#8b5a2b',
    wallTop: '#c49a6c',
    wallEdge: '#4a2f16',
    wallMaterial: 'wood',
    bumperStyle: 'rubber',
    decor: 'palms',
  },
  desert: {
    id: 'desert',
    label: 'Desert',
    outside: '#c4a35a',
    outsideAlt: '#a8843c',
    accent: '#e07a3d',
    trim: '#f0e6d2',
    wall: '#8a6a3a',
    wallTop: '#b8955a',
    wallEdge: '#4a3518',
    wallMaterial: 'stone',
    bumperStyle: 'rubber',
    decor: 'cacti',
  },
  arctic: {
    id: 'arctic',
    label: 'Arctic',
    outside: '#b8d4e8',
    outsideAlt: '#8fb8d4',
    accent: '#5dade2',
    trim: '#ffffff',
    wall: '#7a9bb0',
    wallTop: '#c5d8e6',
    wallEdge: '#3d5566',
    wallMaterial: 'ice',
    bumperStyle: 'metal',
    decor: 'snow',
  },
  volcano: {
    id: 'volcano',
    label: 'Volcano',
    outside: '#2b1410',
    outsideAlt: '#1a0c0a',
    accent: '#ff4500',
    trim: '#ffb347',
    wall: '#4a2c2a',
    wallTop: '#6b3f3a',
    wallEdge: '#1a0e0c',
    wallMaterial: 'stone',
    bumperStyle: 'metal',
    decor: 'lava',
  },
  neon: {
    id: 'neon',
    label: 'Neon Arcade',
    outside: '#12081f',
    outsideAlt: '#1a0f2e',
    accent: '#ff00aa',
    trim: '#00f5ff',
    wall: '#2d1b4e',
    wallTop: '#5b3b8c',
    wallEdge: '#0d0618',
    wallMaterial: 'metal',
    bumperStyle: 'rubber',
    decor: 'grid',
  },
  pirate: {
    id: 'pirate',
    label: 'Pirate Cove',
    outside: '#1a3a4a',
    outsideAlt: '#0f2834',
    accent: '#d4a017',
    trim: '#c0c0c0',
    wall: '#5c4033',
    wallTop: '#8b6914',
    wallEdge: '#2a1c14',
    wallMaterial: 'wood',
    bumperStyle: 'rubber',
    decor: 'waves',
  },
  space: {
    id: 'space',
    label: 'Space',
    outside: '#050510',
    outsideAlt: '#0a0a1a',
    accent: '#a78bfa',
    trim: '#67e8f9',
    wall: '#1e1b4b',
    wallTop: '#312e81',
    wallEdge: '#0c0a24',
    wallMaterial: 'metal',
    bumperStyle: 'metal',
    decor: 'stars',
  },
  autumn: {
    id: 'autumn',
    label: 'Autumn',
    outside: '#5c3a1e',
    outsideAlt: '#3d2614',
    accent: '#e85d04',
    trim: '#f4a261',
    wall: '#6b4226',
    wallTop: '#a0522d',
    wallEdge: '#2f1a0c',
    wallMaterial: 'wood',
    bumperStyle: 'rubber',
    decor: 'leaves',
  },
  castle: {
    id: 'castle',
    label: 'Castle',
    outside: '#3d4555',
    outsideAlt: '#2a303c',
    accent: '#c9a227',
    trim: '#dfe6f0',
    wall: '#5a6270',
    wallTop: '#8a93a3',
    wallEdge: '#1e222a',
    wallMaterial: 'brick',
    bumperStyle: 'metal',
    decor: 'stones',
  },
  candy: {
    id: 'candy',
    label: 'Candy',
    outside: '#f7a8c8',
    outsideAlt: '#e88bb0',
    accent: '#7ec8e3',
    trim: '#fff5b8',
    wall: '#d46a9a',
    wallTop: '#f5a0c0',
    wallEdge: '#8a3a60',
    wallMaterial: 'candy',
    bumperStyle: 'candy',
    decor: 'stripes',
  },
};

export const THEME_IDS = Object.keys(THEMES) as HoleThemeId[];

export function themeForHoleId(id: number): HoleTheme {
  return THEMES[THEME_IDS[(id - 1) % THEME_IDS.length]];
}
