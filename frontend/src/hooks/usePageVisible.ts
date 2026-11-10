import { useEffect, useRef, useState } from 'react';

/**
 * 非 React 版本的可见性订阅（给模块级 store 用，如 useGradingJobs）。
 * 与 `usePageVisible` 共用同一份事件处理，返回退订函数。
 */
export function subscribePageVisible(callback: (visible: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const onChange = () => callback(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/**
 * 页面是否可见（`document.visibilityState === 'visible'`）。
 *
 * 用途：让轮询/重试这类「后台周期性动作」在标签页隐藏时暂停。
 * 浏览器本身会节流后台标签页的定时器（Chrome 降到 1 分钟一次，甚至冻结），
 * 那种节流不可靠也不及时 —— 由应用主动暂停才是确定的行为，回到前台时
 * 立刻补一次，用户不会看到过期数据。
 *
 * SSR/测试环境（无 `document`）下恒为可见，不改变既有行为。
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const unsubscribe = subscribePageVisible(setVisible);
    return unsubscribe;
  }, []);

  return visible;
}

/**
 * 可见性变化时的副作用：隐藏→可见的那一刻执行一次（如立即补一次轮询）。
 *
 * 只认「由隐到显」的跳变，首次挂载不触发（挂载时该拉的数据由调用方自己拉）。
 */
export function useOnBecomeVisible(callback: () => void): void {
  const visible = usePageVisible();
  const firstRef = useRef(true);
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    if (visible) cbRef.current();
  }, [visible]);
}
