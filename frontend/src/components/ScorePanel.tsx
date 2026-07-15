import { type ScoreResult, type WordScore } from '../services/api';
import { SkeuoProgress, SkeuoLED } from './SkeuoUI';
import { IconSparkle } from './icons/SkeuoIcons';
import HeatmapScore from './HeatmapScore';

interface ScorePanelProps {
  score: ScoreResult;
  originalText: string;
  onWordClick?: (word: WordScore) => void;
}

export function ScorePanel({ score, onWordClick }: ScorePanelProps) {
  return (
    <div className="skeuo-panel rounded-2xl p-5 space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 pb-2 border-b border-amber-900/10">
        <div className="skeuo-icon-frame">
          <IconSparkle size={18} />
        </div>
        <h3 className="skeuo-engrave-dark text-base font-bold tracking-wider">SCORE REPORT</h3>
      </div>

      {/* 总分 - LED 大字 + 圆形 VU 进度环 */}
      <div className="flex items-center gap-5">
        {/* VU 圆盘 */}
        <div className="skeuo-vu-meter w-28 h-28 flex-shrink-0 flex flex-col items-center justify-center relative">
          <div className="text-[10px] text-amber-800/70 uppercase tracking-widest absolute top-3">Overall</div>
          <SkeuoLED value={score.overall_score} size="lg" />
          <div className="text-[10px] text-amber-800/70 uppercase tracking-widest absolute bottom-3">Score</div>
        </div>

        {/* 三维评分 */}
        <div className="flex-1 space-y-2.5">
          <DimensionRow
            label="发音准确度"
            englishLabel="Pronunciation"
            value={score.pronunciation_score}
          />
          <DimensionRow
            label="流利度"
            englishLabel="Fluency"
            value={score.fluency_score}
          />
          <DimensionRow
            label="完整度"
            englishLabel="Completeness"
            value={score.completeness_score}
          />
        </div>
      </div>

      {/* v1.1: 逐词热力图（替代旧版 LED 指示灯） */}
      {score.word_scores && score.word_scores.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-amber-900/10">
          <div className="text-xs text-stone-500 uppercase tracking-wider">逐词热力图</div>
          <HeatmapScore wordScores={score.word_scores} onWordClick={onWordClick} />
          <div className="flex gap-3 pt-1 text-[10px] text-stone-500 uppercase tracking-wider">
            <LegendItem colorClass="skeuo-word-led correct" label="正确" />
            <LegendItem colorClass="skeuo-word-led wrong" label="错误" />
            <LegendItem colorClass="skeuo-word-led missing" label="缺失" />
            <LegendItem colorClass="skeuo-word-led extra" label="多余" />
          </div>
        </div>
      )}

      {/* AI 教练反馈 - 老式电报机纸条 */}
      {score.ai_tip && (
        <div className="skeuo-tip flex items-start gap-2.5">
          <IconSparkle size={16} className="text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-amber-800/70 font-semibold mb-1">
              AI 教练 · Coach Tip
            </div>
            <div className="text-sm leading-relaxed">{score.ai_tip}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function DimensionRow({
  label,
  englishLabel,
  value,
}: {
  label: string;
  englishLabel: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 flex-shrink-0">
        <div className="text-xs text-stone-700 font-medium leading-tight">{label}</div>
        <div className="text-[9px] text-stone-400 uppercase tracking-wider">{englishLabel}</div>
      </div>
      <SkeuoProgress value={value} variant="auto" className="flex-1" />
      <SkeuoLED value={value} size="sm" className="w-12 text-center" />
    </div>
  );
}

function LegendItem({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`${colorClass} !m-0 !p-0.5 !text-[8px] w-3.5 h-3.5 inline-flex items-center justify-center`}>·</span>
      {label}
    </span>
  );
}
