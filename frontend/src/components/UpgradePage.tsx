import { useState } from 'react';
import { SkeuoProBadge, SkeuoButton } from './SkeuoUI';
import { IconSparkle } from './icons/SkeuoIcons';

export function UpgradePage({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleUpgrade = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { order_id } = await fetch('http://127.0.0.1:8765/api/payment/order').then(r => r.json());
      const paymentReceipt = `${order_id}_PAID`;
      const res = await fetch('http://127.0.0.1:8765/api/payment/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `receipt=${encodeURIComponent(paymentReceipt)}`,
      });
      const data = await res.json();

      if (data.data?.valid) {
        setResult('🎉 升级成功！所有 Pro 场景已解锁。');
      } else {
        setResult(`❌ 验证失败：${data.data?.message || '请重试'}`);
      }
    } catch (err) {
      setResult('❌ 网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      {/* 黑胶唱机外壳 */}
      <div className="skeuo-cabinet rounded-3xl max-w-md w-full p-6 space-y-4">
        {/* 顶部装饰条 */}
        <div className="flex items-center justify-between pb-3 border-b border-amber-100/10">
          <div className="flex items-center gap-2">
            <SkeuoProBadge />
            <span className="text-amber-100/80 text-sm tracking-wider uppercase">Upgrade</span>
          </div>
          <button onClick={onClose} className="skeuo-close">✕</button>
        </div>

        {/* 黑胶唱片 */}
        <div className="flex justify-center py-4">
          <div className="relative w-40 h-40 rounded-full shadow-2xl"
            style={{
              background: `
                radial-gradient(circle at center,
                  #8B2E2E 0%,
                  #8B2E2E 12%,
                  #1A1A1A 12%,
                  #1A1A1A 14%,
                  #0A0A0A 14%,
                  #0A0A0A 100%
                )`,
              boxShadow: '0 0 0 4px #C49A3F, 0 0 0 6px #5A4012, 0 12px 24px rgba(0,0,0,0.6), inset 0 0 30px rgba(0,0,0,0.5)',
            }}>
            {/* 唱片纹路 */}
            <div className="absolute inset-3 rounded-full"
              style={{
                background: 'repeating-radial-gradient(circle, transparent 0, transparent 2px, rgba(255,255,255,0.04) 2px, rgba(255,255,255,0.04) 3px)',
              }}
            />
            {/* 中心标签 */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 flex items-center justify-center shadow-inner">
              <IconSparkle size={20} className="text-amber-900" />
            </div>
          </div>
        </div>

        {/* 价格 */}
        <div className="text-center space-y-1">
          <div className="text-5xl font-bold text-amber-100" style={{ textShadow: '0 2px 0 rgba(0,0,0,0.4), 0 0 20px rgba(244,210,122,0.3)' }}>
            ¥19
          </div>
          <div className="text-xs text-amber-100/60 tracking-widest uppercase">Lifetime · No Subscription</div>
        </div>

        {/* 特性列表 - 像黑胶曲目 */}
        <div className="skeuo-leather rounded-xl p-4 space-y-2">
          <FeatureLine track="01" text="15+ 高级场景（面试/商务/就医等）" />
          <FeatureLine track="02" text="AI 教练实时纠错反馈" />
          <FeatureLine track="03" text="错题本 + 发音弱点分析" />
          <FeatureLine track="04" text="学习进度跟踪报告" />
        </div>

        {/* 购买按钮 */}
        <SkeuoButton
          variant="brass"
          size="lg"
          fullWidth
          onClick={handleUpgrade}
          disabled={loading}
        >
          {loading ? '处理中...' : '立即购买 ¥19'}
        </SkeuoButton>

        {result && (
          <div className={`
            text-sm text-center py-2.5 rounded-lg
            ${result.startsWith('🎉')
              ? 'bg-green-100/20 text-green-200 border border-green-300/30'
              : 'bg-red-100/20 text-red-200 border border-red-300/30'
            }
          `}>
            {result}
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureLine({ track, text }: { track: string; text: string }) {
  return (
    <div className="flex items-center gap-3 text-amber-100/90">
      <span className="font-mono text-[10px] text-amber-300/60 tracking-widest w-6">TRK {track}</span>
      <span className="w-1 h-1 rounded-full bg-amber-300/60" />
      <span className="text-sm">{text}</span>
    </div>
  );
}
