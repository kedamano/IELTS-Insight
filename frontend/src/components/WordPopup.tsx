/** WordPopup — v1.5 单词弹窗
 * 设计文档 §11.1
 * 点击单词→弹出详情卡片（音标/释义/发音难点/收藏/复制）
 */
import React, { useEffect, useState } from 'react';
import { api, type WordInfo } from '../services/api';
import { IconPlay, IconSparkle } from './icons/SkeuoIcons';

interface Props {
  word: string;
  userPhonetic?: string;
  score?: number;
  errorType?: string;
  tip?: string;
  onClose: () => void;
}

const WordPopup: React.FC<Props> = ({
  word,
  userPhonetic,
  score,
  errorType,
  tip,
  onClose,
}) => {
  const [info, setInfo] = useState<WordInfo | null>(null);

  useEffect(() => {
    const fetchInfo = async () => {
      const data = await api.getWordInfo(word);
      setInfo(data);
    };
    fetchInfo();
  }, [word]);

  const playPronunciation = () => {
    const url = api.getTTSUrl(word, info?.word.includes('en-GB') ? 'en-GB' : 'en-US');
    const audio = new Audio(url);
    audio.play();
  };

  const copyWord = () => {
    navigator.clipboard.writeText(word);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, #FEF9E7 0%, #F5EFE0 100%)',
          boxShadow: '0 12px 48px rgba(0,0,0,0.4), 0 0 0 2px rgba(196,154,63,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-5 py-4"
          style={{ background: 'linear-gradient(180deg, #5C3A1E, #3C2415)' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold text-[#F5EFE0] italic">{word}</h3>
            <button onClick={onClose} className="text-amber-200 hover:text-white text-lg">✕</button>
          </div>
          {info?.phonetic && (
            <div className="text-[#C49A3F] text-sm mt-1">{info.phonetic}</div>
          )}
          {info?.zh && (
            <div className="text-amber-100/60 text-sm mt-0.5">{info.zh}</div>
          )}
        </div>

        <div className="p-4 space-y-3">
          {/* 发音区 */}
          <div className="flex items-center gap-2">
            <button
              onClick={playPronunciation}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white"
              style={{
                background: 'linear-gradient(135deg, #C49A3F, #A07C2E)',
                boxShadow: '0 2px 6px rgba(196,154,63,0.4)',
              }}
            >
              <IconPlay size={14} />
            </button>
            <span className="text-stone-600 text-sm flex-1">播放发音</span>
          </div>

          {/* 发音难点提示 */}
          {info?.pronunciation_tips && info.pronunciation_tips.length > 0 && (
            <div className="space-y-1.5">
              {info.pronunciation_tips.map((t, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2 rounded-lg text-xs"
                  style={{ background: 'rgba(196,154,63,0.1)' }}
                >
                  <IconSparkle size={12} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-amber-800 font-mono font-bold">{t.phoneme}</span>
                    <span className="text-stone-600 ml-1">{t.tip}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 练习反馈（如果有） */}
          {userPhonetic && (
            <div
              className="p-3 rounded-xl space-y-2"
              style={{ background: 'rgba(245,240,224,0.7)', border: '1px solid rgba(200,57,46,0.2)' }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{
                    background: score !== undefined && score >= 80
                      ? '#4CAF50'
                      : score !== undefined && score >= 60
                      ? '#F59E0B'
                      : '#C8392E',
                  }}
                >
                  {score !== undefined ? Math.round(score) : '?'}
                </div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: score !== undefined && score < 80 ? '#C8392E' : '#4CAF50' }}>
                    {errorType || '发音反馈'}
                  </div>
                  <div className="text-[11px] text-stone-500 font-mono">
                    你的发音: {userPhonetic}
                  </div>
                </div>
              </div>
              {tip && (
                <div className="text-xs text-stone-600 pl-9">
                  💡 {tip}
                </div>
              )}
            </div>
          )}

          {/* 释义和例句 */}
          {info?.zh && (
            <div className="text-sm text-stone-700 py-2 border-t" style={{ borderColor: 'rgba(196,154,63,0.2)' }}>
              <span className="text-stone-500 text-xs uppercase tracking-wider">释义</span>
              <div className="mt-1">{info.zh}</div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={copyWord}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #8B7355, #6B5A45)' }}
            >
              📋 复制
            </button>
            <button
              onClick={playPronunciation}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #C49A3F, #A07C2E)' }}
            >
              🔊 再听一次
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WordPopup;
