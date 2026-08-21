// appearance.ts - 外观偏好 (P3.6.2 完善)
// 持久化到 localStorage, 通过 data-attribute + CSS vars 实时生效
//   density:   compact | normal | comfortable
//   accent:    blue | green | purple | orange
//   fontScale: sm | md | lg
//   darkMode:  light | dark | system (留接口, 当前没实现 dark 主题)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Density = 'compact' | 'normal' | 'comfortable';
export type Accent = 'blue' | 'green' | 'purple' | 'orange';
export type FontScale = 'sm' | 'md' | 'lg';
export type DarkMode = 'light' | 'dark' | 'system';

export interface AppearanceState {
  density: Density;
  accent: Accent;
  fontScale: FontScale;
  darkMode: DarkMode;
  setDensity: (d: Density) => void;
  setAccent: (a: Accent) => void;
  setFontScale: (f: FontScale) => void;
  setDarkMode: (d: DarkMode) => void;
  reset: () => void;
}

const DEFAULT: Omit<AppearanceState, 'setDensity' | 'setAccent' | 'setFontScale' | 'setDarkMode' | 'reset'> = {
  density: 'normal',
  accent: 'blue',
  fontScale: 'md',
  darkMode: 'light',
};

const ACCENT_PRIMARY: Record<Accent, string> = {
  blue:   '221 83% 53%',   // 科技蓝 (默认)
  green:  '142 71% 45%',   // 森林绿
  purple: '262 83% 58%',   // 紫罗兰
  orange: '24 95% 53%',    // 暖橙
};

const FONT_SIZE: Record<FontScale, string> = {
  sm: '14px',
  md: '15px',
  lg: '16.5px',
};

const DENSITY_SIZE: Record<Density, string> = {
  compact: '14px',
  normal:  '15px',
  comfortable: '16px',
};

function applyToDom(s: Pick<AppearanceState, 'density' | 'accent' | 'fontScale' | 'darkMode'>) {
  const root = document.documentElement;
  // 主色 (HSL 数值给 Tailwind)
  root.style.setProperty('--primary', ACCENT_PRIMARY[s.accent]);
  // 字号缩放 (根 font-size 决定 rem)
  root.style.setProperty('font-size', FONT_SIZE[s.fontScale]);
  // 密度: 影响行高 / 间距
  root.setAttribute('data-density', s.density);
  // dark 主题: 3 档 (light / dark / system)
  const resolved = resolveDarkMode(s.darkMode);
  root.setAttribute('data-theme-mode', resolved);
  if (s.darkMode === 'system') {
    // 听系统偏好
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => root.setAttribute('data-theme-mode', mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
  }
}

function resolveDarkMode(m: DarkMode): 'light' | 'dark' {
  if (m === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return m;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...DEFAULT,
      setDensity: (d) => {
        set({ density: d });
        applyToDom({ ...useAppearanceStore.getState(), density: d });
      },
      setAccent: (a) => {
        set({ accent: a });
        applyToDom({ ...useAppearanceStore.getState(), accent: a });
      },
      setFontScale: (f) => {
        set({ fontScale: f });
        applyToDom({ ...useAppearanceStore.getState(), fontScale: f });
      },
      setDarkMode: (d) => {
        set({ darkMode: d });
        applyToDom({ ...useAppearanceStore.getState(), darkMode: d });
      },
      reset: () => {
        set(DEFAULT);
        applyToDom(DEFAULT);
      },
    }),
    {
      name: 'ai-cms-appearance',
      onRehydrateStorage: () => (s) => {
        if (s) applyToDom(s);
      },
    },
  ),
);

// 启动时立即应用 (用于 main.tsx import)
export function bootstrapAppearance() {
  const s = useAppearanceStore.getState();
  applyToDom(s);
}
