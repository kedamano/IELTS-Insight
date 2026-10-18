/**
 * test/setup.ts —— vitest setupFiles 唯一入口（test-plan §1：server 生命周期统一在这里管）。
 * 测试文件（含 api.test.ts、feature 测试）不要再自行 listen/reset/close。
 */
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { resetMockState } from './mocks/handlers';
import { server } from './mocks/server';
import { installMatchMedia } from './matchMedia';

// 29 个测试文件并发跑（外加 vite dev / uvicorn 占核）时，msw 回调与 jsdom 渲染会被挤到
// 1 秒以外，`findBy*` 的默认 1000ms 于是变成随机红灯：同一份代码单跑必绿、全跑偶发失败。
// 这里只放宽「等待上限」，不放宽任何断言，也不改测试的期望值。
configure({ asyncUtilTimeout: 4000 });
installMatchMedia();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  resetMockState();
});
afterAll(() => server.close());
