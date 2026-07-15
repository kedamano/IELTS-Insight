import { SkeuoLED } from './SkeuoUI';
import { IconReport, IconSparkle } from './icons/SkeuoIcons';

export function LearningReport() {
  return (
    <div className="flex-1 skeuo-panel rounded-xl flex flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="px-4 py-3 border-b border-amber-900/15 flex items-center gap-2 flex-shrink-0">
        <div className="skeuo-icon-frame dark">
          <IconReport size={18} />
        </div>
        <div>
          <div className="skeuo-engrave-dark text-sm font-bold tracking-wider">LEARNING REPORT</div>
          <div className="text-[10px] text-stone-500 mt-0.5">学习报告</div>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* 累计数据 */}
        <div className="space-y-2.5">
          <StatRow label="今日练习" value="0" suffix="句" />
          <StatRow label="本周累计" value="0" suffix="句" />
          <StatRow label="连续打卡" value="1" suffix="天" />
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-gradient-to-r from-transparent via-amber-900/20 to-transparent" />

        {/* 平均分 VU 表 */}
        <div className="flex flex-col items-center space-y-2 py-2">
          <div className="text-[10px] text-stone-500 uppercase tracking-widest">Average Score</div>
          <div className="skeuo-vu-meter w-24 h-24 flex items-center justify-center">
            <SkeuoLED value="--" size="md" />
          </div>
        </div>

        {/* 空状态提示 */}
        <div className="skeuo-tip text-center text-xs">
          <IconSparkle size={14} className="text-amber-700 inline mr-1" />
          完成第一次录音后，
          <br />
          这里会显示你的学习轨迹
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-stone-600">{label}</span>
      <div className="flex items-baseline gap-1">
        <SkeuoLED value={value} size="sm" />
        <span className="text-[10px] text-stone-500 uppercase">{suffix}</span>
      </div>
    </div>
  );
}
