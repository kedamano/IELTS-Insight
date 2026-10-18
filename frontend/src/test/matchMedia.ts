/**
 * jsdom 不实现 `matchMedia`，而主题需要它解析「跟随系统」（契约 §4 `theme`）。
 * 这里只提供最小可用桩：默认浅色，测试用 `setPrefersDark(true)` 触发 change 监听。
 */
type ChangeHandler = (event: { matches: boolean }) => void;

let prefersDark = false;
const changeHandlers = new Set<ChangeHandler>();

export function setPrefersDark(matches: boolean): void {
  prefersDark = matches;
  for (const handler of changeHandlers) handler({ matches });
}

export function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      media: query,
      matches: /dark/.test(query) ? prefersDark : false,
      onchange: null,
      addEventListener: (_type: string, listener: ChangeHandler) => {
        changeHandlers.add(listener);
      },
      removeEventListener: (_type: string, listener: ChangeHandler) => {
        changeHandlers.delete(listener);
      },
      addListener: (listener: ChangeHandler) => {
        changeHandlers.add(listener);
      },
      removeListener: (listener: ChangeHandler) => {
        changeHandlers.delete(listener);
      },
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList,
  });
}
