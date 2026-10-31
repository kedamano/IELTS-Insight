/**
 * 外壳接线（契约 §15.4 第 7 条）：连上「上一个没退干净的引擎」时，**两处**都要说出来 ——
 * 主区顶部的告警条给细节，左轨那颗状态胶囊给用户瞄一眼就走的地方。
 *
 * 只钉接线，不重复 EngineNotice.test.tsx 对文案的断言。单独一个文件是因为
 * `App.test.tsx` 把 Dashboard mock 成「一渲染就抛」，那颗胶囊的断言不该跟着一起被兜底页干扰。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import App from './App';
import { API_BASE } from './services/api';
import { APP_VERSION } from './version';
import { server } from './test/mocks/server';
import { healthFixture } from './features/settings/testHandlers';

function 让引擎报(版本: string) {
  server.use(
    http.get(`${API_BASE}/health`, () =>
      HttpResponse.json({ data: { ...healthFixture(), version: 版本 } }),
    ),
  );
}

it('引擎版本与界面不一致时，左轨胶囊不再写「引擎已就绪」了事（§15.4 第 7 条）', async () => {
  让引擎报('1.9.0');
  render(<App />);

  await waitFor(
    () => expect(screen.getByText('引擎已就绪（上一个实例）')).toBeInTheDocument(),
    { timeout: 10000 },
  );
  expect(screen.queryByText(/^引擎已就绪$/)).toBeNull();
  // 同一件事在告警条里给出可操作的细节，两处不能互相矛盾
  expect(screen.getByText(/正在使用上一次未退出的引擎/)).toBeInTheDocument();
}, 20000);

it('版本一致时胶囊回到普通绿色态，也不出现告警条', async () => {
  让引擎报(APP_VERSION);
  render(<App />);

  await waitFor(() => expect(screen.getByText('引擎已就绪')).toBeInTheDocument(), { timeout: 10000 });
  expect(screen.queryByText(/上一次未退出的引擎/)).toBeNull();
}, 20000);
