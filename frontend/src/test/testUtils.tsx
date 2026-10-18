import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';

// MSW server 生命周期由 src/test/setup.ts 统一管理（test-plan §1），
// 这里不再 listen/reset/close，feature 测试需要覆写 handler 时直接:
//   import { server } from 'src/test/mocks/server';
//   server.use(...)

const AllProviders = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

const customRender = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  render(ui, { wrapper: AllProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };
