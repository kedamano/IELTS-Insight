/**
 * Icon —— 外壳与控件用的线性图标（Heroicons/Lucide 同一套 24×24 网格、1.7 描边）。
 *
 * CSP 只允许 `'self'`，所以图标全部内联 SVG、用 `currentColor` 继承令牌，
 * 不引 icon 字体也不引外部 CDN；装饰性图标一律 `aria-hidden`，可访问名由按钮文本提供。
 */
import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'dashboard'
  | 'mic'
  | 'headphones'
  | 'book'
  | 'pen'
  | 'bookmark'
  | 'checklist'
  | 'chart'
  | 'sliders'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'chevronLeft'
  | 'chevronRight'
  | 'flame';

const GLYPHS: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  mic: (
    <>
      <path d="M12 2.5a2.8 2.8 0 0 0-2.8 2.8v6a2.8 2.8 0 0 0 5.6 0v-6A2.8 2.8 0 0 0 12 2.5Z" />
      <path d="M18.5 11v1.5a6.5 6.5 0 0 1-13 0V11" />
      <path d="M12 19v2.5" />
    </>
  ),
  headphones: <path d="M3.5 14.5h2.8a1.8 1.8 0 0 1 1.8 1.8v3.2a1.8 1.8 0 0 1-3.6 0v-6a8 8 0 0 1 16 0v6a1.8 1.8 0 0 1-3.6 0v-3.2a1.8 1.8 0 0 1 1.8-1.8h2.8" />,
  book: (
    <>
      <path d="M3 4h5.5a3.5 3.5 0 0 1 3.5 3.5V21a2.5 2.5 0 0 0-2.5-2.5H3Z" />
      <path d="M21 4h-5.5A3.5 3.5 0 0 0 12 7.5V21a2.5 2.5 0 0 1 2.5-2.5H21Z" />
    </>
  ),
  pen: (
    <>
      <path d="M12.5 20.5H21" />
      <path d="M16.2 3.4a2.1 2.1 0 0 1 3 3L8 17.6l-4.2 1 1-4.2Z" />
    </>
  ),
  bookmark: <path d="M19 21.5 12 17l-7 4.5V5.5a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5Z" />,
  checklist: (
    <>
      <path d="M9.5 11.5 12 14l4.5-4.5" />
      <path d="M20.5 12.5v5.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2H10" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 3.5v17h17" />
      <path d="m18.5 9-4.5 4.5-3.5-3.5L6.5 15" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1.5 14h5M9.5 8h5M17.5 16h5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>
  ),
  moon: <path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z" />,
  monitor: (
    <>
      <rect x="2.5" y="3.5" width="19" height="13.5" rx="2" />
      <path d="M8.5 21h7M12 17v4" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  flame: <path d="M12 21.5c4 0 6.5-2.6 6.5-6 0-4.2-4-5.8-4-9.5-2.2 1-3 3-3 4.5-1-.8-1.5-2-1.5-3.5C8 9 5.5 11.5 5.5 15.5c0 3.4 2.5 6 6.5 6Z" />,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** 描边像素边长，默认 18（正文行高 15px 下视觉对齐）。 */
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  );
}

export default Icon;
