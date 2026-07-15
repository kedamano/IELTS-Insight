import { useState } from 'react';
import { SceneList } from './components/SceneList';
import { DialogueArea } from './components/DialogueArea';
import { LearningReport } from './components/LearningReport';
import { IconSparkle, IconScenes } from './components/icons/SkeuoIcons';

export default function App() {
  const [selectedScene, setSelectedScene] = useState<string | null>(null);

  return (
    <div className="flex h-screen w-screen gap-2 p-2">
      {/* 左栏：机柜外壳 - 场景列表 */}
      <aside className="w-72 flex-shrink-0 flex flex-col gap-2">
        {/* 品牌铭牌 */}
        <div className="skeuo-leather rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="skeuo-screw" />
          <div className="flex-1">
            <div className="skeuo-engrave text-base leading-tight">LINGO·1923</div>
            <div className="text-[10px] text-amber-100/60 tracking-widest uppercase">
              Talking Machine
            </div>
          </div>
          <div className="skeuo-screw" />
        </div>

        <SceneList onSelect={setSelectedScene} />
      </aside>

      {/* 中栏：练习区 - 收音机面板 */}
      <main className="flex-1 skeuo-cabinet rounded-2xl overflow-hidden flex flex-col">
        {selectedScene ? (
          <DialogueArea sceneId={selectedScene} />
        ) : (
          <EmptyState />
        )}
      </main>

      {/* 右栏：VU 表盘 + 学习报告 */}
      <aside className="w-80 flex-shrink-0 flex flex-col gap-2">
        <LearningReport />

        {/* 底部品牌信息 */}
        <div className="skeuo-leather rounded-xl px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkle size={16} />
            <span className="text-[10px] text-amber-100/80 uppercase tracking-widest">
              v0.1 · MVP
            </span>
          </div>
          <div className="skeuo-screw" />
        </div>
      </aside>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="skeuo-vu-meter w-32 h-32 mx-auto flex items-center justify-center">
          <IconScenes size={48} className="text-amber-700" />
        </div>
        <div className="skeuo-engrave-dark text-2xl">选择场景开始练习</div>
        <p className="text-stone-500 text-sm max-w-xs mx-auto">
          从左侧场景库选择一个对话场景，开启你的英语口语训练
        </p>
      </div>
    </div>
  );
}
