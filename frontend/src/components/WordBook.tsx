/** WordBook — v1.5 单词本
 * 设计文档 §11.2
 * 收藏列表 + 排序 + 复习模式（看中文说英文 / 听发音选词）+ 导出 CSV
 */
import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { IconPlay } from './icons/SkeuoIcons';

interface WordbookItem {
  id: number;
  word: string;
  phonetic: string;
  zh: string;
  example: string;
  created_at: string;
}

const WordBook: React.FC = () => {
  const [words, setWords] = useState<WordbookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'time' | 'alpha'>('time');

  useEffect(() => {
    loadWords();
  }, []);

  const loadWords = async () => {
    try {
      const data = await api.getWordbook();
      setWords(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (word: string) => {
    await api.removeFromWordbook(word);
    loadWords();
  };

  const handleExportCSV = () => {
    const rows = ['word,phonetic,zh,example,created_at'];
    words.forEach((w) => {
      rows.push(
        `"${w.word}","${w.phonetic}","${w.zh}","${w.example}","${w.created_at}"`
      );
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wordbook_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const playWord = (word: string) => {
    const url = api.getTTSUrl(word);
    const audio = new Audio(url);
    audio.play();
  };

  const sorted = [...words].sort((a, b) => {
    if (sortBy === 'alpha') return a.word.localeCompare(b.word);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  if (loading) {
    return (
      <div className="p-4 text-center text-xs text-stone-500">加载中...</div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-3xl mb-2">📚</div>
        <div className="text-sm text-[#8B7355] font-medium">单词本为空</div>
        <div className="text-xs text-[#9C8B7A] mt-1">点击单词弹窗中的收藏按钮添加</div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setSortBy('time')}
            className={`px-2 py-1 rounded text-xs ${
              sortBy === 'time' ? 'bg-[#C49A3F] text-white' : 'bg-stone-200 text-stone-600'
            }`}
          >
            按时间
          </button>
          <button
            onClick={() => setSortBy('alpha')}
            className={`px-2 py-1 rounded text-xs ${
              sortBy === 'alpha' ? 'bg-[#C49A3F] text-white' : 'bg-stone-200 text-stone-600'
            }`}
          >
            按字母
          </button>
        </div>
        <button
          onClick={handleExportCSV}
          className="px-2 py-1 rounded text-xs bg-[#3C2415] text-amber-100 hover:bg-[#5C3A1E]"
        >
          📥 导出
        </button>
      </div>

      {/* 单词列表 */}
      <div className="space-y-2">
        {sorted.map((w) => (
          <div
            key={w.id}
            className="p-2.5 rounded-lg flex items-start gap-3"
            style={{ background: 'rgba(245,240,224,0.6)' }}
          >
            <button
              onClick={() => playWord(w.word)}
              className="w-6 h-6 rounded-full flex items-center justify-center text-white flex-shrink-0 mt-0.5"
              style={{ background: '#C49A3F' }}
            >
              <IconPlay size={10} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-bold text-[#3C2415]">{w.word}</span>
                {w.phonetic && (
                  <span className="text-xs text-[#9C8B7A] font-mono">{w.phonetic}</span>
                )}
              </div>
              {w.zh && (
                <div className="text-xs text-stone-600 mt-0.5">{w.zh}</div>
              )}
              {w.example && (
                <div className="text-[11px] text-[#9C8B7A] mt-1 italic truncate">
                  {w.example}
                </div>
              )}
            </div>
            <button
              onClick={() => handleRemove(w.word)}
              className="text-[10px] text-[#C8392E] hover:bg-red-50 px-1.5 py-0.5 rounded"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WordBook;
