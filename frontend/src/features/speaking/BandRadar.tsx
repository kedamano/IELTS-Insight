/**
 * BandRadar —— 口语四维（FC/LR/GRA/P）雷达图（契约 §7 命名文件）。
 *
 * §8：素色 SVG，轴用 `--chart-grid`、数据用 `--accent` / `--chart-area`；不出现字面色值。
 * 只是 ScoreBand 列表的补充视觉，`aria-hidden`，读数一律由旁边的文字给出（AC-G5）。
 */
import { TONE_VAR, bandTone } from '../../components/ui';
import type { SpeakingBands, SpeakingCriterion } from '../../types/ielts';
import { SPEAKING_CRITERIA, SPEAKING_CRITERION_LABEL, formatBand } from '../../types/ielts';

export type BandRadarProps = {
  band: SpeakingBands;
  size?: number;
  className?: string;
};

type Point = { x: number; y: number };

function polar(center: number, radius: number, index: number, total: number): Point {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
}

export default function BandRadar({ band, size = 220, className }: BandRadarProps) {
  const center = size / 2;
  const maxRadius = center - 34;
  const axes: SpeakingCriterion[] = [...SPEAKING_CRITERIA];
  const valueOf = (key: SpeakingCriterion): number => {
    const value = band[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(9, Math.max(0, value)) : 0;
  };

  const shape = axes
    .map((key, index) => polar(center, (valueOf(key) / 9) * maxRadius, index, axes.length))
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ');

  return (
    <svg
      role="img"
      aria-label={axes.map((key) => `${SPEAKING_CRITERION_LABEL[key].abbr} ${formatBand(band[key])}`).join('，')}
      width="100%"
      viewBox={`0 0 ${size} ${size}`}
      className={className}
    >
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <circle
          key={ratio}
          cx={center}
          cy={center}
          r={maxRadius * ratio}
          fill="none"
          stroke="var(--chart-grid)"
          strokeWidth={1}
        />
      ))}
      {/* 面积填充交给 --chart-area：深色下 0.12 的主色在卡面上差不到 1.1:1，形状会只剩描边 */}
      <polygon points={shape} fill="var(--chart-area)" stroke="var(--accent)" strokeWidth={1.5} />
      {axes.map((key, index) => {
        const outer = polar(center, maxRadius, index, axes.length);
        const label = polar(center, maxRadius + 18, index, axes.length);
        const value = valueOf(key);
        return (
          <g key={key}>
            <line x1={center} y1={center} x2={outer.x} y2={outer.y} stroke="var(--chart-grid)" strokeWidth={1} />
            <circle
              cx={outer.x}
              cy={outer.y}
              r={3}
              fill={bandTone(value) ? TONE_VAR[bandTone(value)!] : 'var(--ink-muted)'}
            />
            <text
              x={label.x}
              y={label.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="font-code"
              fontSize={11}
              fill="var(--ink-secondary)"
            >
              {SPEAKING_CRITERION_LABEL[key].abbr} {formatBand(band[key])}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
