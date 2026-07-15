import { useEffect, useState, useCallback } from 'react';
import { api, type Scene, type DialogueItem, type ScoreResult } from '../services/api';
import { useRecorder } from '../hooks/useRecorder';
import { useTTS } from '../hooks/useTTS';
import { ScorePanel } from './ScorePanel';
import { SkeuoTab, SkeuoProgress, SkeuoLED } from './SkeuoUI';
import { IconPlay, IconMic, IconStop, IconSpeaker, IconSparkle } from './icons/SkeuoIcons';

export function DialogueArea({
  sceneId,
  onComplete,
  onSentenceClick,
  onWordClick,
}: {
  sceneId: string;
  onComplete?: () => void;
  onSentenceClick?: (sceneId: string, seq: number) => void;
  onWordClick?: (word: string) => void;
}) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(1);
  const [performingRead, setPerformingRead] = useState(false);
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const { recording, duration, start: startRecording, stop: stopRecording } = useRecorder();
  const { playing, play: playTTS } = useTTS();

  useEffect(() => {
    setLoading(true);
    api.getScene(sceneId).then(data => {
      setScene(data);
      setLoading(false);
      setActiveTab(1);
      setScoreResult(null);
      setFeedback(null);
    }).catch(err => {
      console.error('Failed to load scene:', err);
      setLoading(false);
    });
  }, [sceneId]);

  const handlePlaySentence = useCallback(async (text: string) => {
    setFeedback(null);
    try {
      await playTTS(text);
    } catch (err) {
      setFeedback({ type: 'error', message: '播放失败，请检查网络连接' });
    }
  }, [playTTS]);

  const handleReadSentence = useCallback(async () => {
    if (performingRead || recording) return;
    setFeedback(null);
    setPerformingRead(true);
    setScoreResult(null);

    try {
      await startRecording();
      setFeedback({ type: 'info', message: '正在录音，请朗读上方英文...' });
    } catch (err) {
      setFeedback({ type: 'error', message: '无法访问麦克风，请检查权限设置' });
    } finally {
      setPerformingRead(false);
    }
  }, [performingRead, recording, startRecording]);

  const handleStopRead = useCallback(async (dialogueItem: DialogueItem) => {
    if (!recording) return;
    setFeedback(null);

    try {
      const { blob, durationMs } = await stopRecording();
      setFeedback({ type: 'info', message: '正在识别，请稍候...' });

      const { text: userText } = await api.transcribe(blob);
      const result = await api.score(dialogueItem.en, userText, durationMs);
      setScoreResult(result);

      // v1.1: 完成最后一句时触发 onComplete 刷新学习报告
      if (onComplete && activeTab >= (scene?.dialogues.length || 0)) {
        onComplete();
      }

      if (result.overall_score >= 80) {
        setFeedback({ type: 'success', message: '🎉 发音很棒！继续保持！' });
      } else if (result.overall_score >= 60) {
        setFeedback({ type: 'success', message: '👍 不错！可以再注意一下细节发音' });
      } else {
        setFeedback({ type: 'error', message: '💪 继续努力！多听几遍标准发音再试试' });
      }
    } catch (err: any) {
      console.error('Recording failed:', err);
      setFeedback({ type: 'error', message: err.message || '录音识别失败，请重试' });
    }
  }, [recording, stopRecording]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="skeuo-engrave-dark text-stone-500">加载场景中...</div>
      </div>
    );
  }
  if (!scene) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="skeuo-engrave-dark text-stone-500">场景不存在</div>
      </div>
    );
  }

  const activeDialogue = scene.dialogues.find(d => d.seq === activeTab);
  const progress = (activeTab / scene.dialogues.length) * 100;

  return (
    <div className="flex-1 flex flex-col gap-3 p-5 overflow-y-auto">
      {/* ===== 场景信息条 ===== */}
      <div className="skeuo-panel rounded-xl px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="skeuo-engrave-dark text-xl font-bold truncate">{scene.title}</h1>
          <p className="text-xs text-stone-500 mt-1 line-clamp-1">{scene.cultural_notes}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-stone-500 ml-4">
          <span>进度</span>
          <SkeuoLED value={`${activeTab}/${scene.dialogues.length}`} size="sm" />
        </div>
      </div>

      {/* ===== 进度条（金属刻度） ===== */}
      <div className="px-1 flex-shrink-0">
        <SkeuoProgress value={progress} variant="success" />
      </div>

      {/* ===== Tab 导航：卡带仓 ===== */}
      <div className="skeuo-cassette flex items-center gap-1 p-1.5 flex-shrink-0">
        {scene.dialogues.map(d => (
          <SkeuoTab
            key={d.seq}
            active={activeTab === d.seq}
            onClick={() => {
              setActiveTab(d.seq);
              setScoreResult(null);
              setFeedback(null);
            }}
          >
            {d.seq}.{d.speaker}
          </SkeuoTab>
        ))}
      </div>

      {/* ===== 活动对话卡片 ===== */}
      {activeDialogue && (
        <div className="skeuo-panel rounded-2xl p-5 space-y-4 flex-shrink-0">
          {/* 角色 + 关键词 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="skeuo-icon-frame dark">
                <IconSpeaker size={20} />
              </div>
              <div>
                <div className="text-xs text-stone-500 uppercase tracking-wider">Speaker</div>
                <div className="text-sm font-bold text-stone-800">{activeDialogue.role}</div>
              </div>
            </div>
            {activeDialogue.keywords && activeDialogue.keywords.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-stone-500 uppercase">关键词</span>
                {activeDialogue.keywords.map(kw => (
                  <span key={kw} className="px-2 py-0.5 text-[10px] font-mono rounded bg-amber-100/70 text-amber-900 border border-amber-300/50">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 英文内容 - 衬线大字（v1.5: 可点击触发句子解析） */}
          <div
            className="skeuo-engrave-dark text-2xl leading-relaxed py-2 font-display cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => onSentenceClick?.(sceneId, activeDialogue.seq)}
            title="点击查看句子解析"
          >
            "{activeDialogue.en}"
          </div>

          {/* 中文翻译 - 小字 */}
          <div className="text-sm text-stone-600 italic border-l-2 border-amber-700/30 pl-3">
            {activeDialogue.zh}
          </div>

          {/* 发音提示 - 老式便签 */}
          {activeDialogue.tips && (
            <div className="skeuo-tip flex items-start gap-2">
              <IconSparkle size={14} className="text-amber-700 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-800/70 font-semibold">Pronunciation Tip</div>
                <div className="text-sm">{activeDialogue.tips}</div>
              </div>
            </div>
          )}

          {/* ===== 操作按钮组 - 录音机风格 ===== */}
          <div className="flex items-center gap-3 pt-2 border-t border-amber-900/10">
            {/* 播放示范：黄铜按钮 */}
            <button
              onClick={() => handlePlaySentence(activeDialogue.en)}
              disabled={playing}
              className="skeuo-btn-brass px-5 py-2.5 rounded-lg inline-flex items-center gap-2 text-sm"
            >
              <IconPlay size={16} />
              {playing ? '播放中...' : '播放示范'}
            </button>

            {/* 录音：红胶木大键 */}
            {!recording ? (
              <button
                onClick={handleReadSentence}
                disabled={performingRead}
                className="skeuo-btn-rubber px-6 py-2.5 rounded-lg inline-flex items-center gap-2 text-sm"
              >
                <IconMic size={18} />
                {performingRead ? '启动中...' : '跟读'}
              </button>
            ) : (
              <button
                onClick={() => handleStopRead(activeDialogue)}
                className="skeuo-btn-rubber px-6 py-2.5 rounded-lg inline-flex items-center gap-2 text-sm"
                style={{ animationDuration: '1s' }}
              >
                <IconStop size={18} />
                停止 {(duration / 1000).toFixed(1)}s
              </button>
            )}

            {/* 右侧提示：录音时显示电平表 */}
            {recording && (
              <div className="flex-1 flex items-center gap-1 ml-4">
                <div className="text-[10px] text-red-700 font-mono uppercase tracking-wider">REC</div>
                <div className="flex-1 flex items-center gap-0.5 h-3">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{
                        background: i < 12 ? '#2BB565' : i < 18 ? '#D49A1A' : '#C8392E',
                        opacity: i < 8 + Math.sin(Date.now() / 200 + i) * 6 ? 1 : 0.2,
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 0 2px currentColor',
                        transition: 'opacity 0.1s',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 反馈消息 */}
          {feedback && (
            <div className={`
              text-sm px-4 py-2.5 rounded-lg flex items-center gap-2
              ${feedback.type === 'success' ? 'bg-green-100/70 text-green-800 border border-green-300/50' : ''}
              ${feedback.type === 'error' ? 'bg-red-100/70 text-red-800 border border-red-300/50' : ''}
              ${feedback.type === 'info' ? 'bg-amber-100/70 text-amber-800 border border-amber-300/50' : ''}
            `}>
              {feedback.message}
            </div>
          )}
        </div>
      )}

      {/* ===== 评分结果 ===== */}
      {scoreResult && activeDialogue && (
        <div className="flex-shrink-0">
          <ScorePanel
            score={scoreResult}
            originalText={activeDialogue.en}
            onWordClick={(ws) => onWordClick?.(ws.word)}
          />
        </div>
      )}
    </div>
  );
}
