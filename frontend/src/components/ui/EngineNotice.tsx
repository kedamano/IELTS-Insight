import type { HealthResponse } from '../../types/ielts';
import { APP_VERSION } from '../../version';
import { Toast } from './Toast';

export interface EngineNoticeProps {
  /** `/api/health` 的响应；还没探到就不猜（契约 §15.4 第 7 条）。 */
  health: HealthResponse | null | undefined;
}

/** `2026-10-30T21:10:00+08:00` → `2026-10-30 21:10`：用户要认的是「哪一次启动」，不是秒。 */
function startedLabel(iso: string): string {
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return matched ? `${matched[1]} ${matched[2]}` : iso;
}

function portLabel(health: HealthResponse): string {
  return health.port_source === 'probe'
    ? `端口 ${health.port}（已从请求核实）`
    : `端口 ${health.port}（配置值，未能从请求核实）`;
}

/**
 * 「就绪但连的是上一个实例」判定（契约 §15.4 第 7 条）。
 *
 * 告警条与左轨状态胶囊共用它：胶囊是用户瞄一眼就走的地方，如果它永远写「引擎已就绪」，
 * 那条告警就等于被一句绿色状态否定了。
 */
export function usesStaleEngine(
  health: HealthResponse | null | undefined,
): health is HealthResponse {
  return !!health && !!health.version && health.version !== APP_VERSION;
}

/**
 * 「就绪但用的是上一个实例」告警条（契约 §15.4 第 7 条）。
 *
 * 上一个没退干净的引擎占着端口时，外壳会主动让位（§15.4 第 5 条不许杀别人的进程），
 * 界面于是照常就绪 —— 用户以为在用新版本，其实连的是旧引擎，症状是「某个按钮点了没反应」。
 * 位置跟只读降级告警条一样挂在外壳主区顶部：这一件事同样适用于**任何**一屏。
 */
export function EngineNotice({ health }: EngineNoticeProps) {
  if (!usesStaleEngine(health)) return null;

  return (
    <Toast tone="warn">
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          正在使用上一次未退出的引擎（PID {health.pid}），不是本次启动的
        </span>
        <span className="text-xs text-ink-secondary">
          旧引擎 {health.version} · 当前界面 {APP_VERSION} · 启动于 {startedLabel(health.started_at)} ·{' '}
          {portLabel(health)}。它的接口可能与当前界面不匹配，所以某些操作可能没有反应。
        </span>
        <span className="text-xs text-ink-secondary">
          请关闭全部 IELTS Insight 窗口后重新打开；任务管理器里按上面这个 PID 找那个没有界面的
          backend 进程 —— PID 由引擎自己报，不是外壳启动命令那个父进程，所以照号找就能找到
          占着端口和库的那一个。本应用不会替你结束别的进程：误杀正在使用的另一个窗口，
          比端口被占更糟。
        </span>
      </div>
    </Toast>
  );
}

export default EngineNotice;
