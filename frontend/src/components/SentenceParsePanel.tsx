/** SentenceParsePanel — v1.5 句子解析面板
 * 设计文档 §10
 * 用户点击句子时展开解析（词汇/固定表达/文化说明）
 */
import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { IconPlay } from './icons/SkeuoIcons';

interface SentenceParseResult {
  sentence: string;
  phonetic: string;
  words: { word: string; phonetic: string; zh: string }[];
  expressions: { expression: string; zh: string }[];
  cultural_note: string;
  source: string;
}

interface Props {
  sceneId: string;
  seq: number;
  isOpen: boolean;
  onClose: () => void;
}

const SentenceParsePanel: React.FC<Props> = ({ sceneId, seq, isOpen, onClose }) => {
  const [data, setData] = useState<SentenceParseResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && sceneId && seq) {
      loadParse();
    }
  }, [isOpen, sceneId, seq]);

  const loadParse = async () => {
    setLoading(true);
    try {
      // 解析 API：GET /api/sentence-parse/{scene_id}/{seq}
      const res = await fetch(`http://127.0.0.1:8765/api/sentence-parse/${sceneId}/${seq}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const playSentence = () => {
    if (!data?.sentence) return;
    const url = api.getTTSUrl(data.sentence);
    const audio = new Audio(url);
    audio.play();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-y-0 right-0 w-96 z-30 flex flex-col"
      style={{
        background: 'linear-gradient(180deg, #FEF9E7 0%, #F5EFE0 100%)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ background: 'linear-gradient(180deg, #5C3A1E, #3C2415)' }}
      >
        <div>
          <h3 className="text-amber-100 font-bold text-sm">句子解析</h3>
          <div className="text-amber-200/60 text-[10px] mt-0.5">
            点击单词查看详情 · 点击外部关闭
          </div>
        </div>
        <button onClick={onClose} className="text-amber-200 hover:text-white text-lg">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-center text-sm text-stone-500 py-8">加载中...</div>
        ) : data ? (
          <>
            {/* 原句 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">原句</span>
                <button
                  onClick={playSentence}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white"
                  style={{ background: '#C49A3F' }}
                >
                  <IconPlay size={10} />
                </button>
              </div>
              <p className="text-[#3C2415] font-medium leading-relaxed">{data.sentence}</p>
              {data.phonetic && (
                <p className="text-xs text-[#9C8B7A] font-mono mt-1">{data.phonetic}</p>
              )}
            </div>

            {/* 词汇解析 */}
            {data.words && data.words.length > 0 && (
              <div>
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                  📖 词汇解析
                </span>
                <div className="mt-2 space-y-1.5">
                  {data.words.map((w, i) => (
                    <div
                      key={i}
                      className="flex items-baseline gap-2 p-2 rounded-lg"
                      style={{ background: 'rgba(196,154,63,0.08)' }}
                    >
                      <span className="text-[#5C3A1E] font-bold text-sm">{w.word}</span>
                      {w.phonetic && (
                        <span className="text-xs text-[#9C8B7A] font-mono">{w.phonetic}</span>
                      )}
                      {w.zh && <span className="text-xs text-stone-600 ml-auto">{w.zh}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 固定表达 */}
            {data.expressions && data.expressions.length > 0 && (
              <div>
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                  📝 固定表达
                </span>
                <div className="mt-2 space-y-1.5">
                  {data.expressions.map((e, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-lg"
                      style={{ background: 'rgba(245,240,224,0.7)' }}
                    >
                      <div className="text-[#5C3A1E] font-medium text-sm">{e.expression}</div>
                      <div className="text-xs text-stone-600 mt-0.5">{e.zh}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 文化说明 */}
            {data.cultural_note && (
              <div>
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                  🌍 文化说明
                </span>
                <div
                  className="mt-2 p-3 rounded-lg text-sm text-stone-700 leading-relaxed"
                  style={{ background: 'rgba(196,154,63,0.1)', borderLeft: '3px solid #C49A3F' }}
                >
                  {data.cultural_note}
                </div>
              </div>
            )}

            {/* 数据来源 */}
            {data.source && (
              <div className="text-[10px] text-stone-400 pt-2">
                来源：{data.source === 'preset' ? '场景预置' : data.source === 'ai' ? 'AI 生成' : '本地词典'}
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-sm text-stone-500 py-8">暂无解析数据</div>
        )}
      </div>
    </div>
  );
};

export default SentenceParsePanel;
