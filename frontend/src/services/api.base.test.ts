/**
 * services/api.base.test.ts —— VITE_API_BASE 覆盖必须真的生效（契约 §7 / AC-X4）。
 *
 * 7e 实拍踩到的坑：`readEnv()` 先把 `import.meta` 赋给局部变量再取 `.env`，
 * Vite 的静态替换认不出这种写法，dev 里 `import.meta.env` 是 undefined，
 * `VITE_API_BASE` 设了也白设，页面永远打 8765（本文件第三个用例之外的两个用例
 * 在 vitest 里都会绿，因为 vitest 原生提供了 `import.meta.env` 对象 —— 所以补一条源码形状守卫）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// tsconfig 的 types 只开了 vitest/globals（没有 node），所以取源码走 Vite 的 ?raw，
// 不用 node:fs —— 这样也不需要为一个测试放宽全项目类型。
const SOURCES = import.meta.glob('./api.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

describe('API_BASE 取自 VITE_API_BASE', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('源码必须直接写 import.meta.env，不能先别名 import.meta', () => {
    const src = Object.values(SOURCES)[0] ?? '';
    expect(src.length).toBeGreaterThan(0);
    expect(src).toMatch(/import\.meta\.env/);
    expect(src).not.toMatch(/const\s+\w+\s*=\s*import\.meta\s*(as|;)/);
  });

  it('设成相对路径时走同源（vite proxy 联调场景）', async () => {
    vi.stubEnv('VITE_API_BASE', '/api');
    const { API_BASE, apiUrl } = await import('./api');
    expect(API_BASE).toBe('/api');
    expect(apiUrl('/health')).toBe('/api/health');
  });

  it('设成 host:port 时自动补 /api', async () => {
    vi.stubEnv('VITE_API_BASE', 'http://127.0.0.1:8766');
    const { API_BASE } = await import('./api');
    expect(API_BASE).toBe('http://127.0.0.1:8766/api');
  });

  it('不设时回落本机默认端口', async () => {
    // 显式抹掉，免得开发者本地的 .env.local 把这个用例变成假失败
    vi.stubEnv('VITE_API_BASE', undefined);
    const { API_BASE } = await import('./api');
    expect(API_BASE).toBe('http://127.0.0.1:8765/api');
  });
});
