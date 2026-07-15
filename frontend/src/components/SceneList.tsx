import { useEffect, useState } from 'react';
import { api, type SceneListItem } from '../services/api';
import { SkeuoStars, SkeuoProBadge } from './SkeuoUI';
import { getSceneIcon, IconLock } from './icons/SkeuoIcons';

export function SceneList({ onSelect }: { onSelect: (id: string) => void }) {
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api.getScenes().then(data => {
      setScenes(data);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load scenes:', err);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex-1 skeuo-panel rounded-xl flex items-center justify-center">
        <div className="text-stone-500 text-sm">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 skeuo-panel rounded-xl flex flex-col overflow-hidden">
      {/* 顶部固定标题栏 - 雕刻风格 */}
      <div className="px-4 py-3 border-b border-amber-900/15 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="skeuo-engrave-dark text-sm font-bold tracking-wider">SCENE LIBRARY</div>
          <div className="text-[10px] text-stone-500 mt-0.5">{scenes.length} 场景 · 共 {scenes.filter(s => s.is_free).length} 免费</div>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)] animate-pulse" />
          <span className="text-[10px] text-stone-500">就绪</span>
        </div>
      </div>

      {/* 场景列表 - 滚动区 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {scenes.map(scene => {
          const Icon = getSceneIcon(scene.id);
          const isLocked = !scene.is_free;
          const isSelected = selectedId === scene.id;
          return (
            <button
              key={scene.id}
              onClick={() => {
                if (isLocked) return;
                setSelectedId(scene.id);
                onSelect(scene.id);
              }}
              disabled={isLocked}
              className={`
                w-full text-left px-2.5 py-2 rounded-lg
                flex items-center gap-2.5
                transition-all duration-150
                ${isLocked
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer hover:translate-x-0.5'
                }
                ${isSelected
                  ? 'bg-gradient-to-r from-amber-100/80 to-amber-50/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.1)]'
                  : !isLocked
                    ? 'hover:bg-amber-50/50'
                    : ''
                }
              `}
            >
              {/* 金属图标框 */}
              <div className={`skeuo-icon-frame ${isLocked ? 'locked' : ''}`}>
                {isLocked ? <IconLock size={18} /> : <Icon size={20} />}
              </div>

              {/* 文字区 */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-stone-800 truncate">
                  {scene.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <SkeuoStars level={scene.difficulty} />
                  <span className="text-[10px] text-stone-500">
                    {scene.dialogue_count} 句
                  </span>
                </div>
              </div>

              {/* Pro 徽章 */}
              {isLocked && <SkeuoProBadge />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
