/**
 * useTheme —— 外观主题（契约 §4 `theme`：light / dark / system）。
 *
 * 令牌只有两套取值（`index.css` 的 `:root` 与 `:root[data-theme="dark"]`），
 * 本 hook 只做三件事：把 `system` 用 matchMedia 解析成实际明暗、写到 `<html data-theme>`、
 * 把用户的选择 PATCH 回 settings（失败即回滚，不留「界面深色但库里浅色」的假状态）。
 *
 * 用模块级 store + `useSyncExternalStore` 而不是 Context：消费方只有外壳与设置页两处，
 * 但两处都要在主题变化时同步重绘，Context 会把 Provider 塞进整棵树的每个测试渲染里。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { THEME_MODES, type ThemeMode } from '../types/ielts';
import { getSettings, patchSettings } from '../services/api';

/** 解析后的明暗值，即 `<html data-theme>` 的实际取值。 */
export type ResolvedTheme = 'light' | 'dark';

let mode: ThemeMode = 'system';
let systemDark = false;
let synced = false;
let syncing: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** jsdom 没有 `matchMedia`，测试环境按浅色处理，绝不让 hook 抛错。 */
function darkMedia(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function normalize(raw: unknown): ThemeMode {
  return THEME_MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : 'system';
}

export function resolveTheme(next: ThemeMode = mode): ResolvedTheme {
  return next === 'system' ? (systemDark ? 'dark' : 'light') : next;
}

function apply(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme();
}

/** 拉取后端设置并应用。后端未就绪时静默失败，由 `refreshTheme()` 在就绪后重试。 */
function sync(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const settings = await getSettings();
      mode = normalize(settings.theme);
      apply();
      synced = true;
      emit();
    } catch {
      /* 启动早期后端还没起来，这里不该弹错误条 —— 就绪后会再同步一次 */
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** 后端健康检查通过后调用：首屏那次 GET /settings 大概率是失败的。 */
export function refreshTheme(): Promise<void> {
  synced = false;
  return sync();
}

export function getThemeMode(): ThemeMode {
  return mode;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme();
}

/**
 * 切换主题：先乐观应用（点一下就要看到变化，200ms 的网络往返不该挡在前面），
 * 再落库；落库失败回滚到原值并返回中文错误文本。
 */
export async function setThemeMode(next: ThemeMode): Promise<string | null> {
  if (!THEME_MODES.includes(next)) return '主题只能是浅色 / 深色 / 跟随系统';
  const previous = mode;
  mode = next;
  apply();
  emit();
  try {
    const settings = await patchSettings({ theme: next });
    mode = normalize(settings.theme);
    apply();
    synced = true;
    emit();
    return null;
  } catch (error) {
    mode = previous;
    apply();
    emit();
    return error instanceof Error ? error.message : '主题保存失败，请稍后重试';
  }
}

/** 媒体查询只需订阅一次；jsdom 无 `matchMedia` 时按浅色且不重试。 */
let mediaWatched = false;

function watchMedia(): void {
  if (mediaWatched) return;
  mediaWatched = true;
  apply();
  const media = darkMedia();
  if (!media) return;
  systemDark = media.matches;
  apply();
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', (event) => {
      systemDark = event.matches;
      apply();
      emit();
    });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  watchMedia();
  if (!synced && !syncing) void sync();
  return () => {
    listeners.delete(listener);
  };
}

export interface ThemeState {
  /** 用户的原始选择（含 `system`），设置页选中态用它。 */
  mode: ThemeMode;
  /** 实际生效的明暗，外壳图标用它。 */
  resolved: ResolvedTheme;
  /** 返回 null 表示已落库；否则是中文错误文本。 */
  setMode: (next: ThemeMode) => Promise<string | null>;
  /** 在浅色/深色之间切换（`system` 时按当前实际明暗取反）。 */
  toggle: () => Promise<string | null>;
  /** 重新与后端对齐（外壳在引擎就绪后调用）。 */
  refresh: () => Promise<void>;
}

export function useTheme(): ThemeState {
  const current = useSyncExternalStore(subscribe, getThemeMode, getThemeMode);
  const resolved = useSyncExternalStore(subscribe, getResolvedTheme, getResolvedTheme);

  const setMode = useCallback((next: ThemeMode) => setThemeMode(next), []);
  const toggle = useCallback(
    () => setThemeMode(resolveTheme(current) === 'dark' ? 'light' : 'dark'),
    [current],
  );
  const refresh = useCallback(() => refreshTheme(), []);

  return { mode: current, resolved, setMode, toggle, refresh };
}

export default useTheme;
