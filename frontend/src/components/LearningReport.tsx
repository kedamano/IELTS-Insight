import { useEffect, useState } from "react";
import { SkeuoLED } from './SkeuoUI';
import { IconReport, IconSparkle } from './icons/SkeuoIcons';
import { api, type LearningStats } from "../services/api";

export function LearningReport() {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await api.getLearningStats();
      setStats(data);
    } catch {
      // backend unavailable
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 skeuo-panel rounded-xl flex flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="px-4 py-3 border-b border-amber-900/15 flex items-center gap-2 flex-shrink-0">
        <div className="skeuo-icon-frame dark">
          <IconReport size={18} />
        </div>
        <div>
          <div className="skeuo-engrave-dark text-sm font-bold tracking-wider">LEARNING REPORT</div>
          <div className="text-[10px] text-stone-500 mt-0.5">学习报告 · {stats ? `Lv${stats.grade.level}` : "—"}</div>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-3 overflow-y-auto">
        {loading ? (
          <div className="text-center text-xs text-stone-500 py-8">加载中...</div>
        ) : stats ? (
          <>
            {/* 等级 + 连续 */}
            <div className="flex items-center justify-between">
              <div
                className="px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #C49A3F, #A07C2E)", color: "#F5EFE0" }}
              >
                {stats.grade.name}
              </div>
              <div className="text-xs text-stone-600">
                🔥 连续 <strong className="text-[#C49A3F]">{stats.streak}</strong> 天
              </div>
            </div>

            {/* 今日数据 */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard
                label="学习时长"
                value={stats.today.duration_minutes}
                suffix="分"
                icon="⏱"
              />
              <StatCard
                label="练习句子"
                value={stats.today.sentences_count}
                suffix="句"
                icon="📝"
              />
              <StatCard
                label="平均分"
                value={stats.today.avg_score || 0}
                suffix=""
                icon="🎯"
                isScore
              />
            </div>

            {/* 分隔线 */}
            <div className="h-px bg-gradient-to-r from-transparent via-amber-900/20 to-transparent" />

            {/* 本周数据 */}
            <div className="space-y-1.5">
              <StatRow label="本周累计" value={stats.week.sentences_count} suffix="句" />
              <StatRow label="周平均分" value={stats.week.avg_score || 0} suffix="分" />
            </div>

            {/* 发音趋势 */}
            {stats.trend.some((t) => t.score > 0) && (
              <>
                <div className="h-px bg-gradient-to-r from-transparent via-amber-900/20 to-transparent" />
                <div>
                  <div className="text-[10px] text-stone-500 uppercase tracking-wider mb-1.5">发音趋势 · 近7天</div>
                  <div className="flex items-end gap-1 h-10">
                    {stats.trend.map((t, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm transition-all"
                        style={{
                          height: `${Math.max(4, t.score * 0.4)}%`,
                          background: t.score > 0
                            ? "linear-gradient(180deg, #C49A3F, #5C3A1E)"
                            : "rgba(139,115,85,0.2)",
                          minHeight: "4px",
                        }}
                        title={`${t.date}: ${t.score}分`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-[8px] text-stone-400 mt-1">
                    <span>7天前</span><span>今天</span>
                  </div>
                </div>
              </>
            )}

            {/* Top3 错误音素 */}
            {stats.top_errors.length > 0 && (
              <>
                <div className="h-px bg-gradient-to-r from-transparent via-amber-900/20 to-transparent" />
                <div>
                  <div className="text-[10px] text-stone-500 uppercase tracking-wider mb-1.5">Top3 错误音素</div>
                  <div className="space-y-1">
                    {stats.top_errors.map((e, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-[#C8392E] font-mono font-bold">{e.phoneme}</span>
                        <span className="text-stone-500">{e.count} 次</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* 成就 */}
            {stats.achievements.filter((a) => a.condition).length > 0 && (
              <>
                <div className="h-px bg-gradient-to-r from-transparent via-amber-900/20 to-transparent" />
                <div>
                  <div className="text-[10px] text-stone-500 uppercase tracking-wider mb-1.5">已获成就</div>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.achievements
                      .filter((a) => a.condition)
                      .map((a) => (
                        <span
                          key={a.id}
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(196,154,63,0.15)", color: "#C49A3F" }}
                          title={a.desc}
                        >
                          {a.icon} {a.name}
                        </span>
                      ))}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          /* 空状态 */
          <div className="flex-1 flex flex-col items-center justify-center space-y-3">
            <div className="skeuo-vu-meter w-20 h-20 flex items-center justify-center">
              <SkeuoLED value="--" size="md" />
            </div>
            <div className="skeuo-tip text-center text-xs">
              <IconSparkle size={14} className="text-amber-700 inline mr-1" />
              完成第一次录音后，
              <br />
              这里会显示你的学习轨迹
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon,
  isScore,
}: {
  label: string;
  value: number;
  suffix: string;
  icon: string;
  isScore?: boolean;
}) {
  return (
    <div
      className="text-center p-2 rounded-lg"
      style={{ background: "rgba(196,154,63,0.08)" }}
    >
      <div className="text-xs mb-0.5">{icon}</div>
      <div className={`text-sm font-bold ${isScore ? "text-[#C49A3F]" : "text-[#5C3A1E]"}`}>
        {isScore ? (value || 0).toFixed(0) : value}
      </div>
      <div className="text-[9px] text-stone-500">
        {suffix} {label}
      </div>
    </div>
  );
}

function StatRow({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-stone-600">{label}</span>
      <div className="flex items-baseline gap-1">
        <SkeuoLED value={String(value)} size="sm" />
        <span className="text-[10px] text-stone-500 uppercase">{suffix}</span>
      </div>
    </div>
  );
}
