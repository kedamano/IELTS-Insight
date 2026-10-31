import type { StorageHealth } from '../../types/ielts';
import { Toast } from './Toast';

export interface StorageNoticeProps {
  /** 来自 `/api/health` 的 `storage`（契约 §14.6）；没探到就不渲染。 */
  storage: StorageHealth | null | undefined;
}

/**
 * 只读降级告警条（契约 §14.6 界面侧）。
 *
 * 放在外壳主区顶部而不是某一屏里：降级期间用户会在**任何**一屏点保存，
 * 告警只挂在概览等于让写作屏继续丢东西。文案三件事缺一不可 ——
 * 现在是什么状态、代价是什么、下一步做什么。
 */
export function StorageNotice({ storage }: StorageNoticeProps) {
  if (storage == null || storage.state !== 'readonly') return null;

  return (
    <Toast tone="danger">
      <div className="flex flex-col gap-1">
        <span className="font-medium">本机学习库当前只能读</span>
        <span className="text-xs text-ink-secondary">
          {storage.reason ?? '存储层没有通过启动体检，原因未能确认。'}
        </span>
        <span className="text-xs text-ink-secondary">
          从现在起的改动不会保存。请重启应用；若重启后仍然只能读，请查看日志 ——
          学习库文件不会被自动重建或搬走，手工恢复的机会还在。
        </span>
      </div>
    </Toast>
  );
}

export default StorageNotice;
