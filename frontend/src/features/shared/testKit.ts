/**
 * 我这三个模块（report / shared / settings）的测试底座。
 *
 * msw 的 `listen/resetHandlers/close` 由 `src/test/setup.ts` 统一负责（test-plan §1），
 * feature 测试**不要**自己再 listen。注意 setup 的 `afterEach` 会 `resetHandlers()`
 * 卸掉所有 `server.use()` 挂载的运行时 handler，所以每个测试文件要在
 * `beforeEach` 里重新 `install(...)` 自己的 handler。
 *
 * URL 一律用 `services/api.ts` 导出的 `API_BASE` 拼，测试侧也不该出现端口字面量（AC-X4）。
 */
import { HttpResponse, type RequestHandler } from 'msw';
import { server } from '../../test/mocks/server';

/** 挂载 handler（运行时优先级高于 `src/test/mocks/handlers.ts` 的默认集合）。 */
export function install(...list: ReadonlyArray<RequestHandler>): void {
  server.use(...list);
}

/** 契约 §0 的 envelope：`{"data": …, "total"?: n}`。 */
export function envelope<T>(data: T, total?: number): Response {
  return HttpResponse.json(total === undefined ? { data } : { data, total });
}

/** 后端错误形态（中文 detail + 机器码）。 */
export function fail(status: number, detail: string, code = 'test_error'): Response {
  return HttpResponse.json({ detail, code }, { status });
}

/** 音频/文件类端点不走 envelope。 */
export function raw(body: string, contentType: string): Response {
  return new HttpResponse(body, { headers: { 'Content-Type': contentType } });
}
