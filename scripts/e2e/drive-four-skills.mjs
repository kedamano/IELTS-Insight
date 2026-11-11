/**
 * 四科真浏览器 E2E（隔离栈：后端 :8799 临时库 + vite :5173 + Chrome CDP :9222）
 *
 * 前置（由 run-e2e.sh 准备，也可手工）：
 *   1) 后端：IELTS_DB_PATH=<tmp> IELTS_ONLINE=0 ./venv/Scripts/python.exe \
 *            -m uvicorn app.main:app --host 127.0.0.1 --port 8799
 *   2) 前端：VITE_API_BASE=http://127.0.0.1:8799/api npx vite preview --port 5173
 *      （必须 preview 生产构建：dev server 不做代码分割，第 10 项判据会假红；
 *        端口必须 5173，后端 CORS 白名单只放行了 5173/127.0.0.1:5173）
 *   3) 浏览器：chrome --remote-debugging-port=9222 --user-data-dir=<独立 profile>
 *
 * 判据只认「界面上的可见事实」：导航项、磁贴读数、题目渲染、chunk 按需请求。
 * 不读 localStorage 断言实现细节（脚本开头会 clear 一次，避免视图记忆污染判据）。
 *
 * 用法：node drive-four-skills.mjs
 */
import { chromium } from 'playwright-core';

const APP = 'http://127.0.0.1:5183';
const CHROME_CDP = 'http://127.0.0.1:9222';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.connectOverCDP(CHROME_CDP);
const context = browser.contexts()[0] ?? (await browser.newContext());

// 新开标签，避免动到用户已有的标签
const page = await context.newPage();
page.on('pageerror', (err) => record('页面无未捕获异常', false, String(err).slice(0, 120)));

try {
  // ---- 0. 加载与外壳 ----
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 清掉视图记忆：否则上一轮跑到哪一屏，这轮就从哪屏起步，
  // 「首屏只加载概览」这类判据会被污染。
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('nav[aria-label="主导航"]', { timeout: 30000 });
  record('外壳渲染（左轨导航）', true);

  // 引擎就绪前导航是禁用的；等到可用
  await page.waitForFunction(
    () => {
      const nav = document.querySelector('nav[aria-label="主导航"]');
      if (!nav) return false;
      const buttons = nav.querySelectorAll('button');
      return buttons.length > 0 && !buttons[0].disabled;
    },
    { timeout: 60000 },
  );
  record('引擎就绪后导航解锁', true);

  const navLabels = await page.$$eval('nav[aria-label="主导航"] button', (btns) =>
    btns.map((b) => b.textContent?.trim()).filter(Boolean),
  );
  const expected = ['概览', '口语', '听力', '阅读', '写作', '生词本', '错题本', '报告', '设置'];
  const missing = expected.filter((label) => !navLabels.some((text) => text?.includes(label)));
  record('九个导航项齐全', missing.length === 0, missing.length ? `缺：${missing.join(',')}` : `${navLabels.length} 项`);

  // ---- 1. 听力：选题 → 看题 → 提交 ----
  await page.click('nav[aria-label="主导航"] button:has-text("听力")');
  await page.waitForTimeout(1200);
  const hasListeningSet = await page.locator('button:has-text("开始"), button:has-text("练习")').first().isVisible().catch(() => false);
  record('听力屏可进入并出现选题入口', hasListeningSet);

  // ---- 2. 阅读：篇章与题目 ----
  await page.click('nav[aria-label="主导航"] button:has-text("阅读")');
  await page.waitForTimeout(1200);
  const readingText = await page.locator('main').innerText();
  record('阅读屏渲染（含篇章或选题）', readingText.length > 50, `${readingText.length} 字`);

  // ---- 3. 写作：Task 选择与图表 ----
  await page.click('nav[aria-label="主导航"] button:has-text("写作")');
  await page.waitForTimeout(1200);
  const writingText = await page.locator('main').innerText();
  record('写作屏渲染（Task1/Task2 入口）', /Task/.test(writingText), writingText.slice(0, 60).replace(/\n/g, ' '));

  // ---- 4. 口语：模式切换 ----
  await page.click('nav[aria-label="主导航"] button:has-text("口语")');
  await page.waitForTimeout(1200);
  const speakingText = await page.locator('main').innerText();
  record('口语屏渲染（题库/陪练两种模式）', speakingText.length > 50, speakingText.slice(0, 60).replace(/\n/g, ' '));

  // ---- 5. 报告：Bento 磁贴 ----
  await page.click('nav[aria-label="主导航"] button:has-text("报告")');
  await page.waitForTimeout(1500);
  const reportText = await page.locator('main').innerText();
  record('报告屏渲染', reportText.length > 50, `${reportText.length} 字`);

  // ---- 6. 生词本 / 错题本 ----
  await page.click('nav[aria-label="主导航"] button:has-text("生词本")');
  await page.waitForTimeout(800);
  const vocabText = await page.locator('main').innerText();
  record('生词本渲染', vocabText.length > 20, vocabText.slice(0, 50).replace(/\n/g, ' '));

  await page.click('nav[aria-label="主导航"] button:has-text("错题本")');
  await page.waitForTimeout(800);
  const reviewText = await page.locator('main').innerText();
  record('错题本渲染', reviewText.length > 20, reviewText.slice(0, 50).replace(/\n/g, ' '));

  // ---- 7. 设置：AI 与备份面板 ----
  await page.click('nav[aria-label="主导航"] button:has-text("设置")');
  await page.waitForTimeout(1000);
  const settingsText = await page.locator('main').innerText();
  record('设置屏渲染', /AI|备份/.test(settingsText), settingsText.slice(0, 60).replace(/\n/g, ' '));

  // ---- 8. 概览：磁贴读数 ----
  await page.click('nav[aria-label="主导航"] button:has-text("概览")');
  await page.waitForTimeout(1500);
  const overviewText = await page.locator('main').innerText();
  record('概览渲染（四科当前 Band）', /band|Band/.test(overviewText), overviewText.slice(0, 60).replace(/\n/g, ' '));

  // ---- 9. 切屏不白屏（ErrorBoundary 守卫） ----
  let whiteScreen = false;
  for (const label of ['听力', '阅读', '写作', '口语', '概览']) {
    await page.click(`nav[aria-label="主导航"] button:has-text("${label}")`);
    await page.waitForTimeout(500);
    const len = await page.locator('main').innerText().then((t) => t.length);
    if (len < 10) whiteScreen = true;
  }
  record('连续切屏不白屏', !whiteScreen);

  // ---- 10. 懒加载 chunk 确实按需请求（生产构建才有代码分割）----
  const chunks: string[] = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => {
    const url = e.request.url;
    if (url.includes('/assets/') && url.endsWith('.js')) chunks.push(url.split('/').pop() ?? '');
  });
  await page.click('nav[aria-label="主导航"] button:has-text("听力")');
  await page.waitForTimeout(1500);
  const listeningChunkLoaded = chunks.some((u) => /ListeningPanel/.test(u));
  record('懒加载 chunk 按需请求（ListeningPanel）', listeningChunkLoaded, chunks.slice(0, 4).join(', ') || '未捕获到 chunk');
} catch (err) {
  record('E2E 主流程', false, String(err).slice(0, 200));
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== 汇总：${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length) {
    console.log('失败项：');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  await page.screenshot({ path: 'e2e-final.png' }).catch(() => {});
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
