/**
 * 设置页（契约 §1 行 2–5、§4；FR-C / AC-C1 / AC-C2 / AC-C3 / AC-C4）。
 *
 * AC-C1 的形状决定了这里的写法：**每个控件只 PATCH 自己那一个键**。
 * 没有「保存全部」按钮，也没有把整张表单序列化成一个 body ——
 * 那正是旧实现（`services/__init__.py:495-501` 用 Form 默认值）把未改动字段重置回默认值的病因。
 * 后端成功后返回完整 `Settings`，这里用它刷新草稿，避免两次 GET。
 *
 * AC-X1/X2/X4 的边界：所有请求都经 `services/api.ts`（无裸 `fetch`、无端口字面量），
 * 页面上也没有任何「升级 / 解锁 / 专业版」字样 —— 这是个人本地应用，全部功能默认开放。
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, ScoreBand, Toast, cx } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { useTheme } from '../../hooks/useTheme';
import { getSettings, patchSettings } from '../../services/api';
import {
  ACCENT_VOICE,
  BAND_STEPS,
  formatBand,
  type Accent,
  type Settings,
  type SettingsPatch,
  type ThemeMode,
} from '../../types/ielts';
import { AiPanel, type AiPatch } from './AiPanel';
import { AudioDeviceField } from './AudioDeviceField';
import { ChoiceField, DraftField, ToggleField, numberRule, type ChoiceFieldProps } from './fields';

/** `PATCH /settings` 实际发送的 body：`SettingsPatch` 加上后端允许的嵌套 `ai` 子块。 */
export type SettingsPatchBody = SettingsPatch & { ai?: AiPatch };

export interface SettingsPageProps {
  className?: string;
}

const ACCENT_OPTIONS: ChoiceFieldProps<Accent>['options'] = [
  { value: 'en-GB', label: '英音 en-GB' },
  { value: 'en-US', label: '美音 en-US' },
];

const THEME_OPTIONS: ChoiceFieldProps<ThemeMode>['options'] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const BAND_OPTIONS = BAND_STEPS.map((step) => ({
  value: String(step),
  label: `${formatBand(step)}${step === 0 ? '（未测）' : ''}`,
}));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateExamDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null; // 空串 = 清除日期（提交 null）
  if (!ISO_DATE.test(value)) return '考试日期格式应为 YYYY-MM-DD';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '考试日期不是有效日期';
  return null;
}

/** `settings.ai` 在首屏未就绪时的占位（只读展示用，绝不带 key）。 */
const AI_PLACEHOLDER: Settings['ai'] = {
  configured: false,
  base_url_host: null,
  model: null,
  key_source: 'none',
};

export function SettingsPage({ className }: SettingsPageProps) {
  const call = useApi((options) => getSettings(options), []);
  const theme = useTheme();
  const themeMode: ThemeMode = theme.mode;
  const [saved, setSaved] = useState<Settings | null>(null);

  useEffect(() => {
    if (call.data) setSaved(call.data);
  }, [call.data]);

  const settings = saved ?? call.data;

  /** 只发一个（或一组显式）键；返回值即后端合并后的完整设置。 */
  const patch = useCallback(async (body: SettingsPatchBody): Promise<void> => {
    const next = await patchSettings(body);
    setSaved(next);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const next = await call.refetch();
    if (next) setSaved(next);
  }, [call]);

  if (call.loading && !settings) {
    return (
      <div className={cx('flex flex-col gap-3', className)}>
        <Card title="设置">
          <p role="status" className="text-sm text-ink-muted">
            正在读取本机设置…
          </p>
        </Card>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className={cx('flex flex-col gap-3', className)}>
        <Card
          title="设置"
          actions={
            <Button variant="ghost" size="sm" loading={call.loading} onClick={() => void reload()}>
              重试
            </Button>
          }
        >
          <Toast tone="danger">{call.error ?? '设置读取失败，请确认后端已启动。'}</Toast>
        </Card>
      </div>
    );
  }

  const gainRule = numberRule({ label: '录音输入增益', min: 0.5, max: 2 });
  const speedRule = numberRule({ label: '语速', min: 0.5, max: 1.5 });
  const goalRule = numberRule({ label: '每日目标分钟', min: 5, max: 720, integer: true });
  const voiceRule = (raw: string) => (raw.trim() ? null : '音色名不能为空');

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <Card
        title="设置"
        subtitle="所有改动逐项即时保存到本机数据库；只提交你改过的那一项（AC-C1）"
        actions={
          <Button variant="ghost" size="sm" loading={call.loading} onClick={() => void reload()}>
            重新读取
          </Button>
        }
      >
        {call.error ? (
          <Toast tone="danger" action={
            <Button size="sm" variant="ghost" onClick={() => void reload()}>
              重试
            </Button>
          }>
            {call.error}
          </Toast>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
            <Badge tone="neutral">Band 分档</Badge>
            <span className="text-xs">
              ≥7.0 良好 · 5.5–6.5 达标线附近 · ≤5.0 需强化（配色阈值见 `ui/tokens.ts`，全站唯一一处）
            </span>
          </p>
        )}
      </Card>

      <Card title="目标与节奏">
        <div className="flex flex-col gap-3.5">
          <div className="flex items-end gap-4">
            <div className="min-w-0 flex-1">
              <ChoiceField
                id="setting-target-band"
                label="目标 Band"
                value={String(settings.target_band)}
                options={BAND_OPTIONS}
                hint="0–9，步长 0.5；概览页的差距提示与计划引擎都以此为准。"
                onChange={(next) => patch({ target_band: Number(next) })}
              />
            </div>
            <ScoreBand band={settings.target_band} label="当前目标" size="sm" className="w-32 shrink-0" />
          </div>

          <DraftField
            id="setting-exam-date"
            label="考试日期"
            type="date"
            value={settings.exam_date ?? ''}
            validate={validateExamDate}
            hint="留空并保存即清除；概览页的倒计时按这一天计算。"
            onCommit={(raw) => {
              const value = raw.trim();
              return patch({ exam_date: value ? value : null });
            }}
          />

          <DraftField
            id="setting-daily-goal"
            label="每日目标分钟"
            type="number"
            inputMode="numeric"
            step={5}
            min={5}
            max={720}
            value={String(settings.daily_goal_minutes)}
            validate={goalRule}
            hint="5–720 的整数；决定今日计划量与练习热力图的达标分档。"
            onCommit={(raw) => patch({ daily_goal_minutes: Number(raw.trim()) })}
          />
        </div>
      </Card>

      <Card title="外观">
        <div className="flex flex-col gap-3.5">
          <ChoiceField
            id="setting-theme"
            label="主题"
            value={themeMode}
            options={THEME_OPTIONS}
            hint="浅色为默认，深色适合夜间长时间练习；「跟随系统」随 Windows 的明暗设置切换。选择只写入本机设置。"
            onChange={async (next) => {
              // 主题同时驱动 `<html data-theme>`，所以走 useTheme 而不是普通 patch，
              // 否则左轨开关与本页会显示两份互相过期的状态。
              const message = await theme.setMode(next);
              if (message) throw new Error(message);
            }}
          />
        </div>
      </Card>

      <Card title="语音与显示">
        <div className="flex flex-col gap-3.5">
          <ChoiceField
            id="setting-accent"
            label="口音"
            value={settings.accent}
            options={ACCENT_OPTIONS}
            hint={`听力题面与发音默认音色随之变化（英音 ${ACCENT_VOICE['en-GB']} / 美音 ${ACCENT_VOICE['en-US']}）。`}
            onChange={(next) => patch({ accent: next })}
          />

          <DraftField
            id="setting-tts-voice"
            label="TTS 音色名"
            type="text"
            value={settings.tts_voice}
            validate={voiceRule}
            placeholder={ACCENT_VOICE[settings.accent]}
            hint="edge-tts 音色名；切换口音后想跟随默认音色，可在此填入上面对应的名字。"
            onCommit={(raw) => patch({ tts_voice: raw.trim() })}
          />

          <DraftField
            id="setting-tts-speed"
            label="语速"
            type="number"
            inputMode="decimal"
            step={0.05}
            min={0.5}
            max={1.5}
            value={String(settings.tts_speed)}
            validate={speedRule}
            hint="0.5–1.5 倍；听力播放与单词发音共用。"
            onCommit={(raw) => patch({ tts_speed: Number(raw.trim()) })}
          />

          <ToggleField
            id="setting-show-chinese-hints"
            label="题目与反馈显示中文解析"
            checked={settings.show_chinese_hints}
            onChange={(next) => patch({ show_chinese_hints: next })}
          />
          <ToggleField
            id="setting-show-punctuation"
            label="显示标点"
            checked={settings.show_punctuation}
            onChange={(next) => patch({ show_punctuation: next })}
          />
          <ToggleField
            id="setting-online-enabled"
            label="允许在线服务"
            checked={settings.online_enabled}
            hint="偏好开关：无法联网时后端会自动落回本地近似评分，报告会如实标注降级原因。"
            onChange={(next) => patch({ online_enabled: next })}
          />
        </div>
      </Card>

      <Card title="录音输入">
        <div className="flex flex-col gap-3.5">
          <AudioDeviceField
            value={settings.audio_device}
            onChange={(deviceId) => patch({ audio_device: deviceId })}
          />
          <DraftField
            id="setting-input-gain"
            label="录音输入增益"
            type="number"
            inputMode="decimal"
            step={0.05}
            min={0.5}
            max={2}
            value={String(settings.recording_input_gain)}
            validate={gainRule}
            hint="0.5–2.0；麦克风偏轻时适度上调，录音屏在提交前应用该倍率。"
            onCommit={(raw) => patch({ recording_input_gain: Number(raw.trim()) })}
          />
        </div>
      </Card>

      <AiPanel ai={settings.ai ?? AI_PLACEHOLDER} onPatch={(ai) => patch({ ai })} onKeyChanged={reload} />
    </div>
  );
}

export default SettingsPage;
