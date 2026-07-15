/** HeatmapScore — v1.1 热力图评分组件
 *
 * 逐词颜色标注（绿/黄/红），点击单词查看详情
 * 按 v1.1 设计文档第 12.3 节
 */
import React from "react";
import type { WordScore } from "../services/api";

interface Props {
  wordScores: WordScore[];
  onWordClick?: (word: WordScore) => void;
}

const SCORE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  correct: { bg: "rgba(34,197,94,0.25)", text: "rgb(34,197,94)", label: "正确" },
  wrong: { bg: "rgba(239,68,68,0.25)", text: "rgb(239,68,68)", label: "错误" },
  missing: { bg: "rgba(239,68,68,0.15)", text: "rgb(239,68,68)", label: "遗漏" },
  extra: { bg: "rgba(250,204,21,0.25)", text: "rgb(250,204,21)", label: "多余" },
};

function getColor(score?: number, status?: string) {
  if (status && SCORE_COLORS[status]) return SCORE_COLORS[status];
  if (score === undefined) return SCORE_COLORS.correct;
  if (score >= 80) return SCORE_COLORS.correct;
  if (score >= 60) return { bg: "rgba(250,204,21,0.25)", text: "rgb(250,204,21)", label: "一般" };
  return SCORE_COLORS.wrong;
}

const HeatmapScore: React.FC<Props> = ({ wordScores, onWordClick }) => {
  if (!wordScores || wordScores.length === 0) {
    return <span className="text-sm text-[#9C8B7A]">等待评分...</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {wordScores.map((ws, i) => {
        const color = getColor(ws.score, ws.status);
        return (
          <span
            key={i}
            onClick={() => onWordClick?.(ws)}
            className="inline-block px-2 py-0.5 rounded text-sm font-mono cursor-pointer
                       transition-all duration-200 hover:scale-110 hover:shadow-lg"
            style={{
              backgroundColor: color.bg,
              color: color.text,
              border: `1px solid ${color.text}33`,
            }}
            title={
              ws.score !== undefined
                ? `${ws.word}: ${ws.score}分 ${color.label}`
                : `${ws.word}: ${color.label}`
            }
          >
            {ws.word}
          </span>
        );
      })}
    </div>
  );
};

export default HeatmapScore;
