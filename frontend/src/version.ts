import pkg from '../package.json';

/**
 * 界面自身的版本（契约 §15.4 第 7 条的比较基准）。
 *
 * 必须与 `src-tauri/tauri.conf.json`、`backend/app/config.py` 的 `APP_VERSION` 三处一致 ——
 * 只要有一处漂移，「正在使用上一次未退出的旧引擎」就会变成每次启动都出现的噪音，
 * 而噪音会被用户无视，第 7 条防的那个坑也就回来了。专门有一条测试盯着这三处（EngineNotice.test.tsx）。
 */
export const APP_VERSION: string = pkg.version;

export default APP_VERSION;
