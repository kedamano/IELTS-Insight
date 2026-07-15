import { useState, useEffect } from 'react';
import { SceneList } from './components/SceneList';
import { DialogueArea } from './components/DialogueArea';
import { LearningReport } from './components/LearningReport';
import WrongBook from './components/WrongBook';
import WordBook from './components/WordBook';
import OnboardingModal from './components/OnboardingModal';
import WordPopup from './components/WordPopup';
import SentenceParsePanel from './components/SentenceParsePanel';
import SettingsPage from './components/SettingsPage';
import { IconSparkle, IconScenes } from './components/icons/SkeuoIcons';

type RightTab = 'report' | 'wrongbook' | 'wordbook';

export default function App() {
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('report');
  const [reportKey, setReportKey] = useState(0);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [sentenceParseOpen, setSentenceParseOpen] = useState(false);
  const [currentSentence, setCurrentSentence] = useState<{ sceneId: string; seq: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem('onboarding_done');
    if (!done) {
      setShowOnboarding(true);
    }
  }, []);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem('onboarding_done', 'true');
  };

  const handleSceneComplete = () => {
    setReportKey((k) => k + 1);
  };

  const handleSentenceClick = (sceneId: string, seq: number) => {
    setCurrentSentence({ sceneId, seq });
    setSentenceParseOpen(true);
  };

  return (
    <>
      {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}
      {showSettings && <SettingsPage onBack={() => setShowSettings(false)} />}
      {selectedWord && (
        <WordPopup
          word={selectedWord}
          onClose={() => setSelectedWord(null)}
        />
      )}
      {sentenceParseOpen && currentSentence && (
        <SentenceParsePanel
          sceneId={currentSentence.sceneId}
          seq={currentSentence.seq}
          isOpen={sentenceParseOpen}
          onClose={() => setSentenceParseOpen(false)}
        />
      )}

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
            <DialogueArea
              sceneId={selectedScene}
              onComplete={handleSceneComplete}
              onSentenceClick={handleSentenceClick}
              onWordClick={(word) => setSelectedWord(word)}
            />
          ) : (
            <EmptyState />
          )}
        </main>

        {/* 右栏：VU 表盘 + 学习报告 + 错题本 + 单词本 + 设置 */}
        <aside className="w-80 flex-shrink-0 flex flex-col gap-2">
          {/* Tab 切换 */}
          <div className="flex rounded-xl overflow-hidden" style={{ background: "rgba(60,36,21,0.3)" }}>
            {(['report', 'wrongbook', 'wordbook'] as RightTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className="flex-1 py-2 text-xs font-medium transition-all"
                style={{
                  background: rightTab === tab ? 'rgba(196,154,63,0.2)' : 'transparent',
                  color: rightTab === tab ? '#C49A3F' : '#8B7355',
                  borderBottom: rightTab === tab ? '2px solid #C49A3F' : '2px solid transparent',
                }}
              >
                {tab === 'report' ? '📊 报告' : tab === 'wrongbook' ? '📝 错题' : '📚 单词本'}
              </button>
            ))}
          </div>

          {rightTab === 'report' ? (
            <LearningReport key={reportKey} />
          ) : rightTab === 'wrongbook' ? (
            <div className="flex-1 skeuo-panel rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-amber-900/15">
                <div className="skeuo-engrave-dark text-sm font-bold tracking-wider">WRONG BOOK</div>
                <div className="text-[10px] text-stone-500 mt-0.5">错题本</div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <WrongBook />
              </div>
            </div>
          ) : (
            <div className="flex-1 skeuo-panel rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-amber-900/15">
                <div className="skeuo-engrave-dark text-sm font-bold tracking-wider">WORDBOOK</div>
                <div className="text-[10px] text-stone-500 mt-0.5">单词本</div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <WordBook />
              </div>
            </div>
          )}

          {/* 底部品牌信息 */}
          <div className="skeuo-leather rounded-xl px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconSparkle size={16} />
              <span className="text-[10px] text-amber-100/80 uppercase tracking-widest">
                v1.5 · MVP
              </span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="text-[10px] text-amber-100/60 hover:text-amber-100"
            >
              ⚙️ 设置
            </button>
          </div>
        </aside>
      </div>
    </>
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
