/** OnboardingModal — v1.1 首次引导弹窗
 *
 * 4 步引导流程：欢迎 → 选择英语类型 → 麦克风授权 → 模型下载 → 完成
 * 按 v1.1 设计文档第 4 章
 */
import React, { useState, useEffect } from "react";

interface Props {
  onComplete: () => void;
}

const STEPS = [
  { key: "welcome", title: "欢迎", icon: "🎓" },
  { key: "accent", title: "口音", icon: "🗣️" },
  { key: "mic", title: "麦克风", icon: "🎤" },
  { key: "model", title: "模型", icon: "📦" },
  { key: "done", title: "完成", icon: "✅" },
] as const;

const OnboardingModal: React.FC<Props> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [accent, setAccent] = useState<"en-US" | "en-GB">("en-US");
  const [micOK, setMicOK] = useState(false);
  const [micChecking, setMicChecking] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelDownloading, setModelDownloading] = useState(false);

  useEffect(() => {
    if (step === 4) {
      localStorage.setItem("onboarding_done", "true");
      localStorage.setItem("tts_accent", accent);
    }
  }, [step, accent]);

  const checkMic = async () => {
    setMicChecking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicOK(true);
    } catch {
      setMicOK(false);
    } finally {
      setMicChecking(false);
    }
  };

  const downloadModel = () => {
    setModelDownloading(true);
    // 模拟下载进度
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15 + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setTimeout(() => setStep(4), 500);
      }
      setModelProgress(Math.min(progress, 99));
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(28,20,12,0.85)" }}>
      <div
        className="w-full max-w-md mx-4 rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(145deg, #F5EFE0 0%, #EBE0CC 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 2px #C49A3F, inset 0 0 0 1px rgba(255,255,255,0.3)",
        }}
      >
        {/* Header */}
        <div
          className="p-6 text-center"
          style={{ background: "linear-gradient(180deg, #5C3A1E, #3C2415)" }}
        >
          <div className="text-5xl mb-3">
            {step === 0 ? "🎙️" : step === 3 ? "📦" : step === 4 ? "🎉" : STEPS[step].icon}
          </div>
          <h2 className="text-xl font-bold text-[#F5EFE0]" style={{ fontFamily: "'Playfair Display', serif" }}>
            {step === 0
              ? "欢迎来到 AI 英语对话"
              : step === 1
              ? "选择你的英语口音"
              : step === 2
              ? "请允许麦克风权限"
              : step === 3
              ? "下载离线语音模型"
              : "一切就绪！"}
          </h2>
          {step === 0 && (
            <p className="text-sm text-[#C49A3F] mt-2">30 秒内开始你的第一次跟读</p>
          )}
        </div>

        {/* Body */}
        <div className="p-6 min-h-[180px] flex flex-col justify-center">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center space-y-3">
              <p className="text-[#5C3A1E] text-sm leading-relaxed">
                这是一款专注<strong>英语听说</strong>的练习工具。
                <br />
                选择场景 → 听示范 → 跟读 → AI 评分
              </p>
              <div className="flex justify-center gap-2 text-2xl">
                <span>🎧</span><span>🎤</span><span>📊</span><span>🏆</span>
              </div>
            </div>
          )}

          {/* Step 1: Accent */}
          {step === 1 && (
            <div className="space-y-3">
              <div
                onClick={() => setAccent("en-US")}
                className={`p-4 rounded-xl cursor-pointer transition-all ${
                  accent === "en-US" ? "ring-2 ring-[#C49A3F]" : ""
                }`}
                style={{ background: "rgba(255,255,255,0.6)" }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🇺🇸</span>
                  <div>
                    <div className="font-semibold text-[#3C2415]">美式英语</div>
                    <div className="text-xs text-[#8B7355]">American English</div>
                  </div>
                  {accent === "en-US" && <span className="ml-auto text-[#C49A3F]">✓</span>}
                </div>
              </div>
              <div
                onClick={() => setAccent("en-GB")}
                className={`p-4 rounded-xl cursor-pointer transition-all ${
                  accent === "en-GB" ? "ring-2 ring-[#C49A3F]" : ""
                }`}
                style={{ background: "rgba(255,255,255,0.6)" }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🇬🇧</span>
                  <div>
                    <div className="font-semibold text-[#3C2415]">英式英语</div>
                    <div className="text-xs text-[#8B7355]">British English</div>
                  </div>
                  {accent === "en-GB" && <span className="ml-auto text-[#C49A3F]">✓</span>}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Mic */}
          {step === 2 && (
            <div className="text-center space-y-4">
              <div
                className={`text-6xl transition-all ${micOK ? "animate-bounce" : ""}`}
              >
                {micOK ? "✅" : "🎤"}
              </div>
              {micOK ? (
                <p className="text-[#4CAF50] font-medium">麦克风权限已授权！</p>
              ) : (
                <>
                  <p className="text-[#5C3A1E] text-sm">
                    我们需要使用麦克风来录制你的发音
                  </p>
                  <button
                    onClick={checkMic}
                    disabled={micChecking}
                    className="px-6 py-2 rounded-lg font-medium text-white transition-all"
                    style={{
                      background: micChecking
                        ? "#8B7355"
                        : "linear-gradient(135deg, #C49A3F, #A07C2E)",
                      boxShadow: "0 2px 8px rgba(196,154,63,0.4)",
                    }}
                  >
                    {micChecking ? "检测中..." : "允许麦克风"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Step 3: Model */}
          {step === 3 && (
            <div className="text-center space-y-4">
              <div className="text-sm text-[#5C3A1E]">
                正在下载 Whisper 语音模型（约 150MB）
                <br />
                <span className="text-xs text-[#8B7355]">仅首次下载，之后完全离线可用</span>
              </div>
              <div className="h-3 rounded-full bg-[#D4C5A9] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${modelProgress}%`,
                    background: "linear-gradient(90deg, #C49A3F, #E8C763)",
                  }}
                />
              </div>
              <div className="text-xs text-[#9C8B7A]">
                {modelDownloading ? `${Math.round(modelProgress)}%` : "点击开始下载"}
              </div>
              {!modelDownloading && (
                <button
                  onClick={downloadModel}
                  className="px-6 py-2 rounded-lg font-medium text-white transition-all"
                  style={{
                    background: "linear-gradient(135deg, #C49A3F, #A07C2E)",
                    boxShadow: "0 2px 8px rgba(196,154,63,0.4)",
                  }}
                >
                  开始下载
                </button>
              )}
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="text-center space-y-4">
              <div className="text-6xl">🎉</div>
              <p className="text-[#5C3A1E] font-medium text-lg">开始你的第一个场景吧！</p>
              <p className="text-sm text-[#8B7355]">已选择：{accent === "en-US" ? "🇺🇸 美式英语" : "🇬🇧 英式英语"}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 flex items-center justify-between" style={{ background: "rgba(60,36,21,0.05)" }}>
          {/* Step indicators */}
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === step ? "w-6" : ""
                }`}
                style={{
                  background: i <= step ? "#C49A3F" : "rgba(139,115,85,0.3)",
                }}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            {step === 2 && !micOK ? null : step === 3 && modelDownloading ? null : (
              <button
                onClick={() => {
                  if (step === 4) {
                    onComplete();
                  } else {
                    setStep(step + 1);
                  }
                }}
                className="px-6 py-2 rounded-lg font-medium text-white transition-all"
                style={{
                  background: step === 4
                    ? "linear-gradient(135deg, #4CAF50, #388E3C)"
                    : "linear-gradient(135deg, #C49A3F, #A07C2E)",
                  boxShadow: "0 2px 8px rgba(196,154,63,0.4)",
                }}
              >
                {step === 4 ? "开始学习" : "下一步"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
