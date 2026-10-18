/**
 * AI 服务设置（契约 §1 行 2–5、§4；验收 AC-C2 / AC-C3）。
 *
 * 三条不可妥协的规则：
 * - key 只写不读：只能通过 `PUT /settings/ai-key` 写入、`DELETE /settings/ai-key` 清除；
 *   输入框是 `type=password`、永不回填、提交后立刻清空，任何响应都不含明文（AC-C2）。
 * - 状态只说真话：`/health` 的 `whisper.loaded` 与 `settings.ai.configured` 原样呈现，
 *   绝不画假下载进度条（AC-C3 针对旧 `OnboardingModal` 的 simulated progress）。
 * - base_url / model 走部分 PATCH，只带被改动的子字段。
 */
import { useCallback, useState } from 'react';
import { Badge, Button, Card, Toast } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { clearAiKey, health, setAiKey } from '../../services/api';
import type { AiKeySource, AiSettings, HealthResponse } from '../../types/ielts';
import { DraftField } from './fields';

/**
 * 契约 §4 里 `ai` 的可写子字段。
 * 镜像缺口：`types/ielts.ts` 的 `SettingsPatch` 是 `Partial<Omit<Settings, 'ai'>>`，
 * 没有收录后端 `app/api/settings.py` 接受的 `ai.base_url` / `ai.model`；
 * 这里用局部类型，由 SettingsPage 组装成 `SettingsPatch & { ai?: AiPatch }` 后提交。
 */
export type AiPatch = { base_url?: string | null; model?: string };

export interface AiPanelProps {
  /** `GET /settings` 返回的只读 `ai` 块（永不含明文）。 */
  ai: AiSettings;
  onPatch: (patch: AiPatch) => Promise<void>;
  /** key 写入/清除后请求父级重新 `GET /settings`，以刷新 `ai.configured`。 */
  onKeyChanged: () => Promise<void> | void;
  disabled?: boolean;
}

const KEY_SOURCE_LABEL: Record<AiKeySource, string> = {
  env: '来自 .env / 环境变量',
  settings: '来自本页保存',
  none: '未设置',
};

/**
 * `/health` 状态行。这里只说「有没有配好」，不说「能不能打分」：端点是否真的按 OpenAI
 * 协议返回，只有发起评分才知道，届时报告页会如实标出降级原因。
 */
function healthSummary(status: HealthResponse): string {
  const tts = status.tts_ok ? '可用' : '不可用（发音会降级）';
  const ai = status.ai_configured
    ? '已填写（端点异常时评分会标注降级原因）'
    : '未填写（改用本地近似评分）';
  return `后端 ${status.version} · TTS ${tts} · AI 配置 ${ai}`;
}

/** 与后端 `put_ai_key` 同规则：1–300 字符、不含控制字符。错误文本绝不带上 key 本身。 */
function validateKey(raw: string): string | null {
  const value = raw.trim();
  if (!value) return '请先填入密钥';
  if (value.length > 300) return '密钥长度应不超过 300 个字符';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return '密钥不能包含控制字符';
  }
  return null;
}

/** 只接受带 scheme + host 的完整 URL（与后端 `_check_ai_block` 同规则）。 */
function validateBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null; // 空串按「清除」处理，提交 null
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'base_url 应为完整 URL，例如 https://api.example.com/v1';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'base_url 只能用 http 或 https';
  if (!url.hostname) return 'base_url 缺少主机名';
  return null;
}

export function AiPanel({ ai, onPatch, onKeyChanged, disabled = false }: AiPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<'saved' | 'cleared' | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const healthCall = useApi((options) => health(options), [refreshKey]);

  const reload = useCallback(async (): Promise<void> => {
    setRefreshKey((prev) => prev + 1);
    await onKeyChanged();
  }, [onKeyChanged]);

  // 保存失败的中文错误由 DraftField 就地显示（它已经是 role=alert），这里不再重复弹
  // Toast：同一句错误出现两次，读屏会连读两遍，界面上也只会让人以为有两个问题。
  const saveKey = async (raw: string): Promise<void> => {
    const result = await setAiKey(raw);
    // 后端只回状态、不回明文；这里也只渲染状态。
    setNotice(result.ai_key_present ? 'saved' : null);
    await reload();
  };

  const clearKey = async (): Promise<void> => {
    setBusy(true);
    setKeyError(null);
    try {
      await clearAiKey();
      setNotice('cleared');
      setConfirmClear(false);
      await reload();
    } catch (caught: unknown) {
      setKeyError(caught instanceof Error ? caught.message : 'AI 密钥清除失败');
    } finally {
      setBusy(false);
    }
  };

  // 后端未配置时把 key_source 返回为 null，而类型镜像声明为非空；按运行时取默认。
  const source: AiKeySource = ai.key_source ?? 'none';
  const whisper = healthCall.data?.whisper ?? null;

  return (
    <Card
      title="AI 评分服务"
      subtitle="口语 / 写作的 LLM 评分依赖；不配置也能完成听力、阅读与文本兜底练习"
      actions={
        <Badge tone={ai.configured ? 'good' : 'neutral'} dot>
          {ai.configured ? '已配置' : '未配置'}
        </Badge>
      }
      footer={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>密钥来源：{KEY_SOURCE_LABEL[source]}</span>
          <span>接口主机：{ai.base_url_host ?? '默认（未设置 base_url）'}</span>
          <span>模型：{ai.model ?? '默认'}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="rounded-card border border-rule bg-paper-sunken px-3 py-2 text-xs leading-relaxed text-ink-secondary">
          <strong className="font-medium text-ink">密钥存放在哪里？</strong>
          <br />
          填入的密钥只写入<strong className="font-medium text-ink">本机应用数据库</strong>（
          <span className="font-code">settings</span> 表，位于 LOCALAPPDATA 下的 IELTSInsight 目录），
          不进前端代码、不发往第三方、也不写日志。后端任何 GET 只返回
          <span className="font-code"> ai_key_present </span>与
          <span className="font-code"> ai.configured </span>状态，绝不回传明文；本页也不会把密钥回填到输入框，
          更换时直接填入新的值。
        </p>

        {keyError ? (
          <Toast tone="danger" onDismiss={() => setKeyError(null)}>
            {keyError}
          </Toast>
        ) : null}
        {notice === 'saved' ? (
          <Toast tone="good" onDismiss={() => setNotice(null)}>
            已保存：后端只确认了密钥存在，没有回显内容。
          </Toast>
        ) : null}
        {notice === 'cleared' ? (
          <Toast tone="info" onDismiss={() => setNotice(null)}>
            已清除本机保存的密钥；若 .env 另有配置，后端会继续使用那份（见下方「密钥来源」）。
          </Toast>
        ) : null}

        <DraftField
          id="setting-ai-key"
          label="API 密钥"
          type="password"
          value=""
          clearOnCommit
          commitLabel="保存密钥"
          placeholder="填入后保存即清空，不会回显"
          autoComplete="new-password"
          disabled={disabled}
          hint="1–300 个字符、不含控制字符；仅通过 PUT /settings/ai-key 写入本机。"
          validate={validateKey}
          onCommit={(raw) => saveKey(raw)}
        />

        <div className="rule" role="presentation" />

        <DraftField
          id="setting-ai-base-url"
          label="接口 Base URL"
          type="text"
          // 后端只回 host（AC-C2 的最小暴露），所以这里无法回填完整 URL：留空即「不改动」。
          value=""
          placeholder={ai.base_url_host ? `当前主机：${ai.base_url_host}` : 'https://api.example.com/v1'}
          disabled={disabled}
          validate={validateBaseUrl}
          hint="留空并保存即清除该项，回落到 .env 的默认服务商；此处只保存地址，不含密钥。"
          commitLabel="保存地址"
          onCommit={async (raw) => {
            const trimmed = raw.trim();
            await onPatch({ base_url: trimmed ? trimmed : null });
          }}
        />

        <DraftField
          id="setting-ai-model"
          label="模型名"
          type="text"
          value={ai.model ?? ''}
          placeholder="gpt-4o-mini"
          disabled={disabled}
          validate={(raw) => (raw.trim() ? null : '模型名不能为空')}
          hint="模型名会写进评分溯源（例如 ai:glm-4.6），报告页如实展示。"
          commitLabel="保存模型"
          onCommit={async (raw) => {
            await onPatch({ model: raw.trim() });
          }}
        />

        <div className="rule" role="presentation" />

        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-secondary">本地转写（whisper）</span>
            {healthCall.loading ? (
              <span className="font-code text-xs text-ink-muted">读取状态…</span>
            ) : whisper ? (
              <Badge tone={whisper.loaded ? 'good' : 'neutral'} dot>
                {whisper.loaded ? '模型已加载' : '模型未加载（首次使用时才加载）'}
              </Badge>
            ) : (
              <Badge tone="poor" dot>
                状态未知
              </Badge>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            {whisper
              ? `模型：${whisper.model ?? '未指定'}。这里只显示后端上报的真实加载状态，没有模拟进度。`
              : (healthCall.error ?? '尚未取得 /health 状态。')}
          </p>
          {healthCall.data ? (
            <p className="text-xs text-ink-muted">{healthSummary(healthCall.data)}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setRefreshKey((prev) => prev + 1)}>
              重新读取状态
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={disabled || busy || source !== 'settings'}
              onClick={() => setConfirmClear(true)}
            >
              清除本机保存的密钥
            </Button>
          </div>
          {confirmClear ? (
            <Toast
              tone="danger"
              onDismiss={() => setConfirmClear(false)}
              action={
                <Button size="sm" variant="danger" loading={busy} onClick={() => void clearKey()}>
                  确认清除
                </Button>
              }
            >
              清除后口语 / 写作的 AI 评分会回落为规则近似分（报告会标注降级原因）。确定清除吗？
            </Toast>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default AiPanel;
