import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * 磁贴面（spec-contracts.md §8.1）。四块面的底色与墨色都只来自语义 token：
 * `warm` 直接复用琥珀软面（`--highlight-soft` + `--highlight-ink`），所以新增变量只有 `--tile-solid*`。
 */
export type TileSurface = 'plain' | 'hero' | 'solid' | 'warm';

export interface TileProps {
  /** 小标签，进 `<dt>` */
  label: ReactNode;
  /** 主数值，进 `<dd>`；缺失值请传 `—` 而不是 0（AC-P3） */
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  /** 磁贴身份：测试与后续埋点靠它定位，不用 class 或文案当钩子 */
  metric: string;
  surface?: TileSurface;
  size?: 'md' | 'lg';
  /** 块内图表槽位：贴右下角（样机的 `.spark`），由调用方给 `ariaLabel` 说明画的是什么。 */
  chart?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const SURFACE_CLASS: Record<TileSurface, string> = {
  plain: 'border border-rule bg-paper-raised text-ink shadow-tile',
  /* hero 面自带渐变与阴影，再描一圈发丝线会切掉渐变，所以不叠 border */
  hero: 'surface-hero',
  solid: 'bg-tile-solid text-tile-solid-ink shadow-tile',
  warm: 'border border-rule bg-highlight-soft text-highlight-ink',
};

/** 标签与提示的次要墨色：每块面单独给，避免浅色琥珀面上用 `--ink-muted` 掉到 4.5 以下。 */
const LABEL_CLASS: Record<TileSurface, string> = {
  plain: 'text-ink-muted',
  hero: 'text-hero-ink-muted',
  solid: 'text-tile-solid-muted',
  warm: 'text-ink-secondary',
};

/** 数值用 Sora（`font-serif` 映射的是展示面）而不是等宽面：数字要的是字重与字距，不是对齐列。 */
const VALUE_SIZE: Record<NonNullable<TileProps['size']>, string> = {
  md: 'text-[28px]',
  lg: 'text-[38px]',
};

/**
 * 只读数据块（Bento 磁贴）。
 *
 * 装进 `<dl>` 当 `<div><dt>/<dd>` 三元组，所以容器不带 `section`/按钮语义：
 * 磁贴不是可点的东西，点它没有下一步（交互控件一律归 `Card` 的 actions）。
 */
export function Tile({
  label,
  value,
  unit,
  hint,
  metric,
  surface = 'plain',
  size = 'md',
  chart,
  children,
  className,
}: TileProps) {
  return (
    <div
      data-metric={metric}
      data-surface={surface}
      className={cx(
        // 内容贴顶（样机那样：标签→数值→提示在上，留白与内嵌图在下），不做上下两端对齐
        'relative flex min-w-0 flex-col gap-2 rounded-tile px-4 py-3.5',
        SURFACE_CLASS[surface],
        className,
      )}
    >
      <dt className={cx('truncate text-[11px] font-semibold uppercase tracking-[0.04em]', LABEL_CLASS[surface])}>
        {label}
      </dt>
      {/* 有内嵌图时给文字留出右侧槽位，否则窄屏下小字会压到图上 */}
      <dd className={cx('m-0 flex flex-col gap-1', chart != null && 'pe-24')}>
        <span className="flex items-baseline gap-1.5">
          <span className={cx('font-serif font-bold leading-none tracking-[-0.03em] tabular-nums', VALUE_SIZE[size])}>
            {value}
          </span>
          {unit != null ? (
            <span className={cx('text-xs', LABEL_CLASS[surface])}>{unit}</span>
          ) : null}
        </span>
        {hint != null ? <span className={cx('text-xs', LABEL_CLASS[surface])}>{hint}</span> : null}
        {children}
      </dd>
      {chart != null ? (
        <span className="pointer-events-none absolute bottom-3 right-3.5 flex items-end">{chart}</span>
      ) : null}
    </div>
  );
}

export default Tile;
