/**
 * 「题库生成」卡（契约 §17.4；§1 行 40–41）。
 *
 * 存在的理由：README 的「刷完要自己扩」原本只有 CLI 一条路，对普通用户不成立。
 * 这里把同一条管线接到界面上，取舍跟着 §17 走：
 * - **提交即排队**（§10.6）：生成一套题是分钟级上游调用，同步等 = 盯着转圈以为死了；
 * - **离线或未配 AI 时禁用提交并写明原因**（§17.2/§17.4），不出现「点了转圈两分钟然后失败」；
 * - **成功后必须写「重启应用后生效」**（§17.1）：装载只在启动时发生，`content_counts` 是启动快照，
 *   当场不会动 —— 假装题库立刻变多就是界面说谎；
 * - rejected 逐条带中文原因（§17.3 条款 4），部分成功照常显示。
 *
 * 轮询自己管（2.5s，与 useGradingJobs 同节奏）而**不接进那个 store**：
 * 生成任务的产物是文件不是练习记录，混进批改队列会让左轨「正在批改 N」把等题也算成批改（§17.3 条款 3）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Tile, Toast } from '../../components/ui';
import { describeActionError, generateContent, contentJob, isApiError } from '../../services/api';
import type { Band, ContentJob, ContentModule } from '../../types/ielts';
import { CONTENT_MODULE_LABEL_ZH, formatBand } from '../../types/ielts';

const POLL_INTERVAL_MS = 2500;

const MODULES: readonly ContentModule[] = ['speaking', 'listening', 'reading', 'writing', 'sparring'];

const BAND_OPTIONS: readonly Band[] = [5.5, 6.5, 7.5];

/** 目标模块的中文标签 + 一句「生成出来是什么」，避免用户在五个词里猜。 */
const MODULE_HINT: Record<ContentModule, string> = {
  speaking: 'Part 1 话题或 Part 2 题卡（含 Part 3 追问）',
  listening: '一套 20 题的听力（音频首次播放时合成并缓存）',
  reading: '一篇 800–950 词原创篇章 + 13 题',
  writing: 'Task 1 图表题或 Task 2 作文题',
  sparring: '1 对 1 陪练的一个新场景话题',
};

export interface ContentPanelProps {
  /** §17.4：未配置 AI（health.ai_configured=false）时禁用提交。 */
  aiConfigured: boolean;
  /** §17.2：用户关掉在线服务时禁用提交（当场 503 不如不点）。 */
  onlineEnabled: boolean;
  storageReadonly?: boolean;
}

type Phase = 'idle' | 'submitting' | 'running' | 'done' | 'failed';

export function ContentPanel({ aiConfigured, onlineEnabled, storageReadonly = false }: ContentPanelProps) {
  const [module, setModule] = useState<ContentModule>('sparring');
  const [count, setCount] = useState(1);
  const [band, setBand] = useState<Band>(6.5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [job, setJob] = useState<ContentJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 卸载即停轮询：组件在设置屏里，切走屏不该继续在后台打端点。
  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    (jobId: string) => {
      void (async () => {
        try {
          const next = await contentJob(jobId);
          setJob(next);
          if (next.status === 'succeeded') {
            stopPolling();
            setPhase('done');
          } else if (next.status === 'failed') {
            stopPolling();
            setPhase('failed');
            setError(next.error || '生成失败，原因未回传');
          }
        } catch (caught) {
          // 404：任务已不在后端（多半是重启过）——停轮询并如实说，别永远转圈。
          if (isApiError(caught) && caught.status === 404) {
            stopPolling();
            setPhase('failed');
            setError('生成任务已不在引擎里（引擎可能重启过），请重新提交。');
          }
        }
      })();
    },
    [stopPolling],
  );

  const startPolling = useCallback(
    (jobId: string) => {
      jobIdRef.current = jobId;
      stopPolling();
      poll(jobId);
      timerRef.current = setInterval(() => poll(jobId), POLL_INTERVAL_MS);
    },
    [poll, stopPolling],
  );

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError(null);
    setJob(null);
    try {
      const created = await generateContent({ module, count, target_band: band });
      setJob(created);
      if (created.status === 'succeeded') {
        setPhase('done');
      } else if (created.status === 'failed') {
        setPhase('failed');
        setError(created.error || '生成失败');
      } else {
        setPhase('running');
        startPolling(created.job_id);
      }
    } catch (caught) {
      setPhase('idle');
      setError(describeActionError(caught, '提交生成任务没成功'));
    }
  }, [band, count, module, startPolling]);

  const busy = phase === 'submitting' || phase === 'running';
  const blocked = !aiConfigured || !onlineEnabled || storageReadonly;
  const blockReason = storageReadonly
    ? '学习库当前只能读，生成要写文件，先重启应用恢复可写。'
    : !onlineEnabled
      ? '已关闭联网：生成题目要调用 AI 端点。请在上方「语音与显示」里开启在线服务。'
      : !aiConfigured
        ? '未配置 AI 端点：请在上方「AI 批改」里填好可用的 OpenAI 兼容端点与密钥。'
        : null;

  const report = job?.report ?? null;

  return (
    <Card
      title="题库生成"
      subtitle="让 AI 按官方格式补几套原创题，写进本机题库；重启应用后进入练习"
      actions={
        blocked ? (
          <Badge tone="mid" dot title={blockReason ?? undefined}>
            暂不可用
          </Badge>
        ) : (
          <Badge tone="accent" dot>
            {CONTENT_MODULE_LABEL_ZH[module]}
          </Badge>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {blocked ? (
          <Toast tone="warn" autoDismissMs={0}>
            {blockReason}
          </Toast>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <ModulePicker value={module} onChange={setModule} disabled={busy || blocked} />
          <div className="min-w-40 flex-1">
            <span className="text-xs font-medium text-ink-secondary">目标 Band（难度）</span>
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="生成难度">
              {BAND_OPTIONS.map((option) => {
                const selected = option === band;
                return (
                  <Button
                    key={option}
                    size="sm"
                    variant={selected ? 'primary' : 'default'}
                    disabled={busy || blocked}
                    aria-pressed={selected}
                    onClick={() => setBand(option)}
                  >
                    {formatBand(option)}
                  </Button>
                );
              })}
            </div>
          </div>
          <label className="flex min-w-28 flex-col gap-1 text-xs font-medium text-ink-secondary">
            数量（1–5）
            <input
              type="number"
              min={1}
              max={5}
              value={count}
              disabled={busy || blocked}
              onChange={(event) => {
                const raw = event.target.value;
                const parsed = Number(raw);
                if (Number.isFinite(parsed)) setCount(Math.min(5, Math.max(1, Math.round(parsed))));
              }}
              className="rounded-control border border-rule bg-paper px-2 py-1 text-sm text-ink disabled:opacity-45"
            />
          </label>
        </div>

        <p className="text-xs text-ink-muted">{MODULE_HINT[module]}。生成内容全部原创并标注来源，不含任何真题原文。</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={phase === 'submitting'} disabled={busy || blocked} onClick={() => void submit()}>
            {busy ? '生成中' : '开始生成'}
          </Button>
          {phase === 'running' ? (
            <span className="text-xs text-ink-muted">每套题约需几十秒到一两分钟，可离开这一屏。</span>
          ) : null}
        </div>

        {phase === 'running' ? (
          <div className="flex flex-col gap-1.5" aria-hidden="true">
            <div className="skeleton h-3 w-3/4 rounded-full" />
            <div className="skeleton h-3 w-1/2 rounded-full" />
          </div>
        ) : null}

        {error ? (
          <Toast tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Toast>
        ) : null}

        {phase === 'done' && report ? (
          <div className="flex flex-col gap-3">
            <dl aria-label="生成结果" className="grid grid-cols-2 gap-3">
              <Tile
                metric="content.written"
                label="已生成"
                value={report.written}
                unit="套"
                hint={report.written > 0 ? '重启应用后进入题库' : '没有合格产物'}
              />
              <Tile metric="content.requested" label="本次请求" value={report.requested} unit="套" hint="上限 5 套 / 次" />
            </dl>

            {report.generated.length ? (
              <ul className="flex flex-col gap-1.5">
                {report.generated.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 rounded-control bg-paper-sunken px-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-ink">{item.title_zh || item.id}</span>
                    <span className="font-code shrink-0 text-xs text-ink-muted">{item.id}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {report.rejected.length ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-secondary">被拒绝（未入库）</span>
                {report.rejected.map((item, index) => (
                  <div key={`${item.id ?? 'x'}-${index}`} className="rounded-control border border-rule bg-paper-sunken px-3 py-1.5 text-xs text-ink-secondary">
                    {item.id ? <span className="font-code text-ink-muted">{item.id}：</span> : null}
                    {item.reasons.join('；')}
                  </div>
                ))}
              </div>
            ) : null}

            <p className="text-xs text-ink-muted">
              产物已写入本机学习库目录（受备份保护）。<strong className="font-medium text-ink">重启应用后</strong>
              这些题才会进入各屏的选题列表——生成时不会当场改变题库读数。
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** 模块选择：五个中文标签 + 一句说明，不用裸机器名。 */
function ModulePicker({
  value,
  onChange,
  disabled,
}: {
  value: ContentModule;
  onChange: (next: ContentModule) => void;
  disabled: boolean;
}) {
  return (
    <div className="min-w-40 flex-1">
      <span className="text-xs font-medium text-ink-secondary">生成什么</span>
      <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="生成目标">
        {MODULES.map((option) => {
          const selected = option === value;
          return (
            <Button
              key={option}
              size="sm"
              variant={selected ? 'primary' : 'default'}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(option)}
            >
              {CONTENT_MODULE_LABEL_ZH[option]}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export default ContentPanel;
