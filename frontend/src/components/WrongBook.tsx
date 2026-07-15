/** WrongBook — v1.1 错题本组件
 *
 * 音素分类统计 + 掌握状态 + 复习入口
 * 按 v1.1 设计文档第 8.5 节
 */
import React, { useEffect, useState } from "react";
import { api, type WrongRecord, type WrongStats } from "../services/api";

const ERROR_TYPE_CN: Record<string, string> = {
  "元音错误": "元音",
  "辅音错误": "辅音",
  "连读问题": "连读",
  "弱读缺失": "弱读",
  "重音错误": "重音",
  "语调问题": "语调",
  "": "未分类",
};

const ERROR_TYPE_COLORS: Record<string, string> = {
  "元音错误": "#F59E0B",
  "辅音错误": "#EF4444",
  "连读问题": "#8B5CF6",
  "弱读缺失": "#3B82F6",
  "重音错误": "#EC4899",
  "语调问题": "#10B981",
  "": "#9CA3AF",
};

const WrongBook: React.FC = () => {
  const [stats, setStats] = useState<WrongStats | null>(null);
  const [records, setRecords] = useState<WrongRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsData, recordsData] = await Promise.all([
        api.getWrongStats(),
        api.getWrongRecords(undefined, false),
      ]);
      setStats(statsData);
      setRecords(recordsData);
    } catch {
      // backend not available
    } finally {
      setLoading(false);
    }
  };

  const handleMarkMastered = async (word: string, sceneId: string) => {
    await api.markWrongMastered(word, sceneId);
    loadData();
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-[#9C8B7A] text-sm">加载错题本...</div>
    );
  }

  if (!stats || stats.total_wrong === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-3xl mb-2">🎉</div>
        <div className="text-sm text-[#8B7355] font-medium">暂无错题</div>
        <div className="text-xs text-[#9C8B7A] mt-1">继续练习，发音会越来越好！</div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* 统计概览 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded" style={{ background: "rgba(196,154,63,0.15)" }}>
          <div className="text-lg font-bold text-[#C49A3F]">{stats.total_wrong}</div>
          <div className="text-[10px] text-[#8B7355]">全部错题</div>
        </div>
        <div className="text-center p-2 rounded" style={{ background: "rgba(239,68,68,0.1)" }}>
          <div className="text-lg font-bold text-[#C8392E]">{stats.active_wrong}</div>
          <div className="text-[10px] text-[#8B7355]">未掌握</div>
        </div>
        <div className="text-center p-2 rounded" style={{ background: "rgba(34,197,94,0.1)" }}>
          <div className="text-lg font-bold text-[#4CAF50]">{stats.mastered}</div>
          <div className="text-[10px] text-[#8B7355]">已掌握</div>
        </div>
      </div>

      {/* Top 错误音素 */}
      {stats.top_phonemes.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-[#5C3A1E] mb-1.5">🔴 高频错误音素</div>
          <div className="space-y-1">
            {stats.top_phonemes.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-[#C8392E] font-mono font-bold">{p.phoneme}</span>
                <div className="flex-1 mx-2 h-1.5 rounded-full bg-[#3C2415]/10 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (p.count / stats.top_phonemes[0].count) * 100)}%`,
                      background: "linear-gradient(90deg, #C8392E, #E8756A)",
                    }}
                  />
                </div>
                <span className="text-[#9C8B7A]">{p.count}次</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 错题列表 */}
      <div>
        <div className="text-xs font-semibold text-[#5C3A1E] mb-1.5">📝 最近错题</div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {records.slice(0, 10).map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 p-1.5 rounded text-xs"
              style={{ background: "rgba(245,240,224,0.5)" }}
            >
              <span
                className="px-1 py-0.5 rounded text-[10px] font-medium text-white"
                style={{ background: ERROR_TYPE_COLORS[r.error_type] || "#9CA3AF" }}
              >
                {ERROR_TYPE_CN[r.error_type] || "其他"}
              </span>
              <span className="font-mono font-bold text-[#C8392E]">{r.word}</span>
              <span className="text-[#9C8B7A] flex-1 truncate">{r.phonetic_expected}</span>
              <span
                className="text-[10px] cursor-pointer hover:underline"
                style={{ color: "#4CAF50" }}
                onClick={() => handleMarkMastered(r.word, r.scene_id)}
              >
                掌握 ✓
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WrongBook;
