import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Card, Icon, cx, type BadgeTone, type IconName } from './components/ui';
import { useBackendReady } from './hooks/useBackendReady';
import { useGradingJobs } from './hooks/useGradingJobs';
import { useTheme } from './hooks/useTheme';
import type { ThemeMode } from './types/ielts';
import { Dashboard } from './features/report/Dashboard';
import { ReportPage } from './features/report/ReportPage';
import { SpeakingPanel } from './features/speaking/SpeakingPanel';
import { GradingRailBadge } from './features/shared/GradingJobs';
import { ListeningPanel } from './features/listening/ListeningPanel';
import ReadingPanel from './features/reading/ReadingPanel';
import { WritingPanel } from './features/writing/WritingPanel';
import { VocabBook } from './features/shared/VocabBook';
import { ReviewBook } from './features/shared/ReviewBook';
import { SettingsPage } from './features/settings/SettingsPage';

/** 左轨视图状态机（无路由库，§0 IA 的顺序即优先级） */
export type ViewId =
  | 'overview'
  | 'speaking'
  | 'listening'
  | 'reading'
  | 'writing'
  | 'vocab'
  | 'review'
  | 'report'
  | 'settings';

type ViewMeta = {
  id: ViewId;
  label: string;
  note: string;
  icon: IconName;
  group: (typeof NAV_GROUPS)[number];
};

/** 分组标题即信息架构的三段：练（输入+输出）→ 复盘 → 配置。 */
const NAV_GROUPS = ['练习', '复盘', '本机'] as const;

const VIEWS: readonly ViewMeta[] = [
  { id: 'overview', label: '概览', note: '目标 band、考试倒计时、四科当前 band 与今日任务', icon: 'dashboard', group: '练习' },
  { id: 'speaking', label: '口语', note: 'Part 1 快问快答 / Part 2 题卡计时 / Part 3 追问', icon: 'mic', group: '练习' },
  { id: 'listening', label: '听力', note: '2 section × 10 题，逐句重听与 0.75×–1.25× 倍速', icon: 'headphones', group: '练习' },
  { id: 'reading', label: '阅读', note: '800–950 词原创篇章 + 13 题，20 分钟限时', icon: 'book', group: '练习' },
  { id: 'writing', label: '写作', note: 'Task 1 图表描述（本地 SVG）/ Task 2 议论文，四维批改', icon: 'pen', group: '练习' },
  { id: 'vocab', label: '生词本', note: '跨模块生词、搭配与话题标签、CSV/Anki 导出', icon: 'bookmark', group: '复盘' },
  { id: 'review', label: '错题本', note: '按科目与错误类型筛选，手动标记已掌握', icon: 'checklist', group: '复盘' },
  { id: 'report', label: '报告', note: 'band 趋势、题型正确率、错误类型分布、练习时长', icon: 'chart', group: '复盘' },
  { id: 'settings', label: '设置', note: '目标分、考试日期、口音、AI 与录音设备', icon: 'sliders', group: '本机' },
];

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string; icon: IconName }> = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' },
];

export default function App() {
  const [view, setView] = useState<ViewId>('overview');
  const [helperOpen, setHelperOpen] = useState(true);
  const backend = useBackendReady();
  const grading = useGradingJobs();
  const theme = useTheme();
  const active = viewMeta(view);

  // 首屏那次 GET /settings 大概率撞在未就绪的后端上，健康检查通过后与库里对齐一次（AC-G1）。
  useEffect(() => {
    if (backend.ready) void theme.refresh();
  }, [backend.ready, theme.refresh]);

  return (
    <div className="flex h-screen w-screen overflow-x-auto bg-paper-sunken text-ink">
      {/* 左轨导航（216px） */}
      <nav
        aria-label="主导航"
        className="flex w-[216px] shrink-0 flex-col gap-4 border-r border-rule bg-paper-raised px-3 py-5"
      >
        <div className="flex items-center gap-2.5 px-1">
          <span
            aria-hidden="true"
            className="surface-hero grid h-9 w-9 shrink-0 place-items-center rounded-control text-[13px] font-semibold"
          >
            II
          </span>
          <div className="min-w-0">
            <div className="truncate font-serif text-[15px] leading-tight font-semibold text-ink">IELTS Insight</div>
            <div className="mt-0.5 text-xs text-ink-muted">个人雅思备考</div>
          </div>
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group} className="flex flex-col gap-1">
            <div className="px-2 text-[11px] font-medium tracking-wide text-ink-muted">{group}</div>
            <ul className="flex flex-col gap-0.5">
              {VIEWS.filter((item) => item.group === group).map((item) => (
                <li key={item.id}>
                  <NavButton
                    item={item}
                    selected={item.id === view}
                    disabled={!backend.ready}
                    onSelect={setView}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="mt-auto flex flex-col gap-3 px-1">
          <GradingRailBadge jobs={grading.jobs} onOpen={(job) => setView(job.module)} />
          <ThemeSwitch />
          <div className="flex flex-col gap-2">
            <Badge tone={backend.ready ? 'good' : backend.state === 'failed' ? 'poor' : 'mid'} dot>
              {backend.state === 'ready'
                ? '引擎已就绪'
                : backend.state === 'failed'
                  ? '引擎未就绪'
                  : '启动中'}
            </Badge>
            <span className="text-[11px] text-ink-muted">v2.0 · 本地单机</span>
          </div>
        </div>
      </nav>

      {/* 主区（≥720px） */}
      <main className="canvas flex min-w-[720px] flex-1 flex-col gap-4 overflow-y-auto p-5">
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-[22px] leading-tight font-semibold text-ink">{active.label}</h1>
            <p className="mt-1 text-xs text-ink-muted">{active.note}</p>
          </div>
          {!helperOpen ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHelperOpen(true)}
              aria-controls="helper-column"
              aria-expanded={false}
              icon={<Icon name="chevronLeft" size={15} />}
            >
              显示辅助栏
            </Button>
          ) : null}
        </header>

        {/* key 变化即重放入场动画：视图切换要有方向感，不能是硬切 */}
        <div key={backend.ready ? view : 'boot'} className="view-enter flex flex-col gap-4">
          {!backend.ready ? <BootPanel backend={backend} /> : renderView(view, setView)}
        </div>
      </main>

      {/* 右辅助栏（320px，可折叠） */}
      {helperOpen ? (
        <aside
          id="helper-column"
          aria-label="辅助信息"
          className="flex w-[320px] shrink-0 flex-col gap-3 border-l border-rule bg-paper-raised px-3 py-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-secondary">辅助信息</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHelperOpen(false)}
              aria-controls="helper-column"
              aria-expanded
            >
              <Icon name="chevronRight" size={15} />
              收起
            </Button>
          </div>
          <EngineCard backend={backend} />
          <Card title="当前模块" subtitle={active.note}>
            <p className="text-xs text-ink-muted">
              备考目标与考试日期在「设置」中维护；练习记录会实时反映到「概览」和「报告」。
            </p>
          </Card>
        </aside>
      ) : null}
    </div>
  );
}

function NavButton({
  item,
  selected,
  disabled,
  onSelect,
}: {
  item: ViewMeta;
  selected: boolean;
  disabled: boolean;
  onSelect: (next: ViewId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      disabled={disabled}
      aria-current={selected ? 'page' : undefined}
      className={cx(
        'press relative flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm',
        selected
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-ink-secondary hover:bg-paper-sunken hover:text-ink',
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      {/* 选中态用左侧短条 + 底色双通道表达，不靠颜色单独承载信息 */}
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-1/2 -left-1 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent transition-opacity',
          'duration-[var(--motion-fast)]',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
      <Icon name={item.icon} size={17} className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

/** 外观主题三段开关（契约 §4 `theme`）：点一下立即生效，落库失败就回滚并就地报错。 */
function ThemeSwitch() {
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);

  const pick = async (next: ThemeMode): Promise<void> => {
    setError(await theme.setMode(next));
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        role="group"
        aria-label="外观主题"
        className="flex gap-1 rounded-control border border-rule bg-paper-sunken p-1"
      >
        {THEME_OPTIONS.map((option) => {
          const selected = theme.mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={option.label}
              title={option.label}
              aria-pressed={selected}
              onClick={() => void pick(option.value)}
              className={cx(
                'press grid h-7 flex-1 place-items-center rounded-[7px]',
                selected ? 'bg-paper-raised text-accent shadow-elevated' : 'text-ink-muted hover:text-ink',
              )}
            >
              <Icon name={option.icon} size={15} />
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-ink-secondary">
          {error}
        </p>
      ) : (
        <p className="px-1 text-[11px] text-ink-muted">
          {theme.mode === 'system'
            ? `跟随系统 · 当前${theme.resolved === 'dark' ? '深色' : '浅色'}`
            : THEME_OPTIONS.find((option) => option.value === theme.mode)?.label ?? '浅色'}
        </p>
      )}
    </div>
  );
}

type BackendReady = ReturnType<typeof useBackendReady>;

/** 就绪前不允许进入任何模块（AC-G1），失败时给出可点的重试与最后错误文本 */
function BootPanel({ backend }: { backend: BackendReady }) {
  const failed = backend.state === 'failed';
  return (
    <Card title={failed ? '本地引擎未就绪' : '正在启动本地引擎'}>
      <div className="flex flex-col gap-3" role="status" aria-live="polite">
        <p className={cx('text-sm', failed ? 'text-ink' : 'text-ink-secondary')}>{backend.message}</p>
        {failed && backend.lastError ? (
          <p className="rounded-card border border-rule bg-paper-sunken px-2.5 py-2 font-code text-xs text-ink-secondary">
            {backend.lastError}
          </p>
        ) : null}
        <div>
          <Button variant={failed ? 'primary' : 'default'} onClick={backend.retry} loading={backend.state === 'pending'}>
            {failed ? '重试' : '立即重试'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** 引擎真实状态（AC-C3：显示 whisper 懒加载的真实状态，不做假下载进度） */
function EngineCard({ backend }: { backend: BackendReady }) {
  const health = backend.health;
  const rows: ReadonlyArray<{ label: string; value: string; tone: BadgeTone }> = [
    {
      label: '语音模型',
      value: health ? (health.whisper.loaded ? `已加载 · ${health.whisper.model}` : '未加载（首次使用时加载）') : '待确认',
      tone: health?.whisper.loaded ? 'good' : 'mid',
    },
    { label: 'AI 批改', value: health?.ai_configured ? '已配置' : '未配置（离线近似分）', tone: health?.ai_configured ? 'good' : 'mid' },
    { label: '音频合成', value: health ? (health.tts_ok ? '可用' : '不可用') : '待确认', tone: health?.tts_ok ? 'good' : 'mid' },
  ];

  return (
    <Card title="本地引擎" subtitle={backend.ready ? undefined : '健康检查通过后解锁模块'}>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start justify-between gap-2">
            <span className="text-xs text-ink-muted">{row.label}</span>
            <Badge tone={row.tone}>{row.value}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function viewMeta(view: ViewId): ViewMeta {
  return VIEWS.find((item) => item.id === view) ?? VIEWS[0];
}

/** §7：外壳只负责视图切换与跨页入口，业务状态一律留在各 features 组件内。 */
function renderView(view: ViewId, setView: (next: ViewId) => void): ReactNode {
  switch (view) {
    case 'overview':
      return <Dashboard />;
    case 'speaking':
      return <SpeakingPanel />;
    case 'listening':
      return <ListeningPanel />;
    case 'reading':
      return <ReadingPanel />;
    case 'writing':
      return <WritingPanel />;
    case 'vocab':
      return <VocabBook />;
    case 'review':
      return <ReviewBook />;
    case 'report':
      return (
        <ReportPage
          onOpenReviewBook={() => setView('review')}
          onOpenVocabBook={() => setView('vocab')}
        />
      );
    case 'settings':
      return <SettingsPage />;
  }
}
