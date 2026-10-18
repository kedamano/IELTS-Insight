/**
 * 录音输入设备选择（AC-C4）。
 *
 * 只做三件事：`enumerateDevices()` 列出真实输入设备、把选中的 `deviceId` 存成
 * `settings.audio_device`、提示这个值会被录音屏交给 `getUserMedia({ audio: { deviceId } })`。
 * 设备枚举是浏览器 API，不经过 `services/api.ts`，因此这里没有裸 `fetch`。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '../../components/ui';
import { listAudioInputDevices } from '../../hooks/useRecorder';

/** `''` 是「系统默认」哨兵值，落库为 `null`（契约 §4 `audio_device: null`）。 */
const SYSTEM_DEFAULT = '';

export interface AudioDeviceFieldProps {
  value: string | null;
  onChange: (deviceId: string | null) => Promise<void>;
  /** 后端 `settings.online_enabled` 之类的全局禁用不用管，这里只跟随加载状态。 */
  disabled?: boolean;
}

export function AudioDeviceField({ value, onChange, disabled = false }: AudioDeviceFieldProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [listing, setListing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setListing(true);
    setError(null);
    try {
      setDevices(await listAudioInputDevices());
    } catch (caught: unknown) {
      setDevices([]);
      setError(caught instanceof Error ? caught.message : '读取麦克风列表失败');
    } finally {
      setListing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.addEventListener) return;
    const onChange_ = (): void => void refresh();
    mediaDevices.addEventListener('devicechange', onChange_);
    return () => mediaDevices.removeEventListener('devicechange', onChange_);
  }, [refresh]);

  const options = devices.map((device, index) => ({
    value: device.deviceId,
    label: device.label?.trim() || `麦克风 ${index + 1}（未授权时不显示名称）`,
  }));
  // 后端存的设备已拔出时仍保留该选项，避免下拉把选择悄悄改回默认值。
  const known = value === null || options.some((option) => option.value === value);

  return (
    <Field
      label="录音输入设备"
      htmlFor="setting-audio-device"
      hint={
        known
          ? '保存后录音屏会用该 deviceId 调用 getUserMedia({ audio: { deviceId } })；未授权麦克风时设备名称可能为空。'
          : `当前保存的设备（${value ?? ''}）暂时不在列表里，插回后会自动出现。`
      }
      error={error}
    >
      {(aria) => (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <select
            {...aria}
            id="setting-audio-device"
            className="h-9 min-w-0 flex-1 rounded-card border border-rule bg-paper px-2 text-sm text-ink outline-none focus:border-[var(--accent)]"
            value={value ?? SYSTEM_DEFAULT}
            disabled={disabled || saving}
            onChange={(event) => {
              const next = event.target.value === SYSTEM_DEFAULT ? null : event.target.value;
              setSaving(true);
              void onChange(next).finally(() => setSaving(false));
            }}
          >
            <option value={SYSTEM_DEFAULT}>系统默认麦克风</option>
            {!known && value !== null ? <option value={value}>已保存的设备（当前不可用）</option> : null}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" loading={listing} disabled={disabled} onClick={() => void refresh()}>
            重新检测
          </Button>
          </div>
          {!listing && devices.length === 0 ? (
            <p role="status" className="text-xs text-ink-muted">
              没有读到任何录音输入设备（未授权麦克风或本机无输入设备）；可点「重新检测」，或先用系统默认。
            </p>
          ) : null}
        </div>
      )}
    </Field>
  );
}

export default AudioDeviceField;
