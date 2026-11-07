/**
 * 键盘焦点环的源码判据（契约 §8.4）。
 *
 * 为什么用扫源码而不是渲染出来量 computed style：jsdom 不做层叠，
 * `getComputedStyle(el).outlineStyle` 在这种用例里永远拿不到浏览器算出来的值 ——
 * 一条「断言环存在」的 jsdom 测试会**永远绿**，那正是这条契约最需要防的假安心。
 * 行为侧的证据在真浏览器 Tab 巡检里（§15.9 那条实拍记录），这里只钉「不许有人把环关掉」。
 *
 * 读文件走 `import.meta.glob(..., { query: '?raw' })` 而不是 `node:fs`：
 * 本项目的 `tsconfig.json` 把 `types` 收成 `["vitest/globals"]`，引 `node:fs` 会让
 * `npx tsc -b` 直接红（质量门第 1 关），而 glob 是 vite/client 自带的，零配置。
 */
import { describe, expect, it } from 'vitest';

/** `src` 下所有 tsx + 本文件所在目录的 css，键是相对本文件的路径。 */
const 组件源码 = import.meta.glob('./**/*.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const 样式源码 = import.meta.glob('./index.css', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/**
 * §8.4 第 3 条：唯一的豁免形态是**非控件容器**。
 * 往这个数组里加文件，等于声明「该文件的 `outline-none` 都画在容器上」—— 评审时看得见，
 * 不许靠行内注释豁免。`features/**` 的表单字段不许进这里。
 */
const 容器豁免 = ['./components/ui/Modal.tsx'];

/** 命中 `outline-none` 的 文件:行号。 */
function 隐形焦点命中(): string[] {
  const 命中: string[] = [];
  for (const [路径, 源码] of Object.entries(组件源码)) {
    if (容器豁免.includes(路径)) continue;
    源码.split('\n').forEach((行: string, index: number) => {
      if (行.includes('outline-none')) 命中.push(`${路径}:${index + 1}`);
    });
  }
  return 命中;
}

describe('焦点环判据（契约 §8.4）', () => {
  it('glob 真的扫到了东西（防止判据自己变成空转）', () => {
    // 这条不是凑数：glob 路径写错、`?raw` 没生效，前两条就会对着空对象全绿。
    expect(Object.keys(组件源码).length).toBeGreaterThan(30);
    expect(Object.keys(样式源码)).toHaveLength(1);
  });

  it('除容器豁免外，源码里不许出现 outline-none', () => {
    // §8.4 第 2 条：Tailwind utility 层排在 base 之后，而全局那条规则用 `:where()` 写是零特异性，
    // 所以任何一个 `outline-none` 都必然盖掉焦点环 —— 这里出现一处，界面上就有一处看不见焦点。
    expect(隐形焦点命中()).toEqual([]);
  });

  it('容器豁免清单里的文件确实还在，且仍是容器', () => {
    // 豁免清单会腐烂：文件改名或删掉之后，一条「已豁免」的记录比没有记录更坏，
    // 因为它让下一个人以为这个口子还有效。
    for (const 路径 of 容器豁免) {
      const 源码 = 组件源码[路径];
      expect(源码, `豁免清单里的 ${路径} 找不到了`).toBeTypeOf('string');
      expect(源码!, `豁免的 ${路径} 里已经没有 outline-none，请把豁免一并删掉`).toContain('outline-none');
      // 容器的判据：`tabIndex={-1}` 的容器才配豁免，控件不配。
      expect(源码!, `${路径} 不再是容器（没有 tabIndex={-1}）`).toContain('tabIndex={-1}');
    }
  });

  it('焦点环仍然只在 index.css 里定义一处', () => {
    const css = Object.values(样式源码)[0]!;
    const 定义 = css.match(/:focus-visible\s*\{[^}]*outline:/g) ?? [];
    expect(定义).toHaveLength(1);
    expect(css).toContain('@layer base');
  });

  it('不许正值 tabIndex', () => {
    // §8.4 第 4 条：一个 `tabIndex={1}` 就能把整屏顺序打乱，而截图上完全看不出来。
    const 命中: string[] = [];
    for (const [路径, 源码] of Object.entries(组件源码)) {
      源码.split('\n').forEach((行: string, index: number) => {
        const m = 行.match(/tabIndex=\{(\d+)\}/);
        if (m && Number(m[1]) > 0) 命中.push(`${路径}:${index + 1} → ${m[0]}`);
      });
    }
    expect(命中).toEqual([]);
  });
});
