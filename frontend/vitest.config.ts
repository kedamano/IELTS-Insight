import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // 32 个 jsdom 文件并行，冷启动那一轮机器最忙（transform 缓存还没热）会撞到默认 5s 上限：
    // 实测同一条命令第一趟 49s / 17 个超时，第二趟 26s 全绿。断言的等待另有
    // `asyncUtilTimeout: 4000`（src/test/setup.ts）兜着，逻辑错误照样在 4 秒内亮红，
    // 所以这里抬高的只是「机器慢」的容忍度，不是「等不到东西」的容忍度。
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
