/** SettingsPage — v1.5 设置页面
 * 设计文档 §13.3.3
 * 包含：练习模式、Shadowing 延迟、播放速度、TTS 语音、联网开关、音频设备选择
 */
import React, { useEffect, useState } from 'react';

interface Settings {
  practice_mode: 'normal' | 'shadowing';
  shadowing_delay: number;
  playback_speed: number;
  tts_voice: 'en-US' | 'en-GB';
  online_enabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  practice_mode: 'normal',
  shadowing_delay: 0.5,
  playback_speed: 1.0,
  tts_voice: 'en-US',
  online_enabled: true,
};

interface Props {
  onBack: () => void;
}

const SettingsPage: React.FC<Props> = ({ onBack }) => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');

  useEffect(() => {
    loadSettings();
    loadAudioDevices();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8765/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings({ ...DEFAULT_SETTINGS, ...data.data });
        setSelectedDevice(data.data?.audio_device || '');
      }
    } catch {
      // ignore
    }
  };

  const loadAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      setAudioDevices(audioInputs);
    } catch {
      // ignore
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const form = new FormData();
      form.append('practice_mode', settings.practice_mode);
      form.append('shadowing_delay', String(settings.shadowing_delay));
      form.append('playback_speed', String(settings.playback_speed));
      form.append('tts_voice', settings.tts_voice);
      form.append('online_enabled', settings.online_enabled ? 'true' : 'false');

      await fetch('http://127.0.0.1:8765/api/settings', {
        method: 'POST',
        body: form,
      });
      onBack();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(28,20,12,0.8)' }}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, #FEF9E7 0%, #F5EFE0 100%)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center gap-3"
          style={{ background: 'linear-gradient(180deg, #5C3A1E, #3C2415)' }}
        >
          <button onClick={onBack} className="text-amber-200 hover:text-white">←</button>
          <h2 className="text-amber-100 font-bold text-lg flex-1">设置</h2>
          <div className="skeuo-screw" style={{ width: 10, height: 10 }} />
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* 联网功能 */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-[#3C2415]">联网功能</div>
              <div className="text-xs text-stone-500 mt-0.5">
                启用后可使用 AI 深度点评和 edge-tts 高质量语音
              </div>
            </div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.online_enabled}
                onChange={(e) =>
                  setSettings({ ...settings, online_enabled: e.target.checked })
                }
                className="sr-only"
              />
              <div
                className="w-11 h-6 rounded-full transition-all relative"
                style={{
                  background: settings.online_enabled
                    ? 'linear-gradient(135deg, #C49A3F, #A07C2E)'
                    : 'rgba(139,115,85,0.3)',
                }}
              >
                <span
                  className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{
                    transform: settings.online_enabled ? 'translateX(20px)' : 'none',
                  }}
                />
              </div>
            </label>
          </div>

          {/* 练习模式 */}
          <div>
            <div className="font-medium text-[#3C2415] mb-2">练习模式</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSettings({ ...settings, practice_mode: 'normal' })}
                className={`p-3 rounded-xl text-sm transition-all ${
                  settings.practice_mode === 'normal'
                    ? 'ring-2 ring-[#C49A3F] bg-[#C49A3F]/10'
                    : 'bg-white/60 hover:bg-white/80'
                }`}
              >
                <div className="text-2xl mb-1">🎯</div>
                <div className="font-medium">普通模式</div>
                <div className="text-[10px] text-stone-500">逐句跟读</div>
              </button>
              <button
                onClick={() => setSettings({ ...settings, practice_mode: 'shadowing' })}
                className={`p-3 rounded-xl text-sm transition-all ${
                  settings.practice_mode === 'shadowing'
                    ? 'ring-2 ring-[#C49A3F] bg-[#C49A3F]/10'
                    : 'bg-white/60 hover:bg-white/80'
                }`}
              >
                <div className="text-2xl mb-1">🏃</div>
                <div className="font-medium">Shadowing</div>
                <div className="text-[10px] text-stone-500">影子跟读</div>
              </button>
            </div>
          </div>

          {/* Shadowing 延迟 */}
          {settings.practice_mode === 'shadowing' && (
            <div>
              <div className="font-medium text-[#3C2415] mb-2">Shadowing 延迟</div>
              <div className="flex gap-2">
                {[0.3, 0.5, 0.7].map((delay) => (
                  <button
                    key={delay}
                    onClick={() => setSettings({ ...settings, shadowing_delay: delay })}
                    className="flex-1 py-2 rounded-lg text-sm font-medium"
                    style={{
                      background:
                        settings.shadowing_delay === delay
                          ? 'linear-gradient(135deg, #C49A3F, #A07C2E)'
                          : 'rgba(255,255,255,0.6)',
                      color: settings.shadowing_delay === delay ? '#FEF9E7' : '#5C3A1E',
                    }}
                  >
                    {delay.toFixed(1)}s
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 播放速度 */}
          <div>
            <div className="font-medium text-[#3C2415] mb-2">播放速度</div>
            <div className="flex gap-2">
              {[0.75, 1.0, 1.25].map((speed) => (
                <button
                  key={speed}
                  onClick={() => setSettings({ ...settings, playback_speed: speed })}
                  className="flex-1 py-2 rounded-lg text-sm font-medium"
                  style={{
                    background:
                      settings.playback_speed === speed
                        ? 'linear-gradient(135deg, #C49A3F, #A07C2E)'
                        : 'rgba(255,255,255,0.6)',
                    color: settings.playback_speed === speed ? '#FEF9E7' : '#5C3A1E',
                  }}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>

          {/* TTS 语音 */}
          <div>
            <div className="font-medium text-[#3C2415] mb-2">TTS 语音</div>
            <div className="flex gap-2">
              <button
                onClick={() => setSettings({ ...settings, tts_voice: 'en-US' })}
                className="flex-1 py-2 rounded-lg text-sm font-medium"
                style={{
                  background:
                    settings.tts_voice === 'en-US'
                      ? 'linear-gradient(135deg, #C49A3F, #A07C2E)'
                      : 'rgba(255,255,255,0.6)',
                  color: settings.tts_voice === 'en-US' ? '#FEF9E7' : '#5C3A1E',
                }}
              >
                🇺🇸 美式
              </button>
              <button
                onClick={() => setSettings({ ...settings, tts_voice: 'en-GB' })}
                className="flex-1 py-2 rounded-lg text-sm font-medium"
                style={{
                  background:
                    settings.tts_voice === 'en-GB'
                      ? 'linear-gradient(135deg, #C49A3F, #A07C2E)'
                      : 'rgba(255,255,255,0.6)',
                  color: settings.tts_voice === 'en-GB' ? '#FEF9E7' : '#5C3A1E',
                }}
              >
                🇬🇧 英式
              </button>
            </div>
          </div>

          {/* 音频设备 */}
          {audioDevices.length > 0 && (
            <div>
              <div className="font-medium text-[#3C2415] mb-2">麦克风设备</div>
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="w-full p-2 rounded-lg border border-[#C49A3F]/30 bg-white/60 text-sm"
              >
                <option value="">-- 默认设备 --</option>
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `麦克风 ${audioDevices.indexOf(device) + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 flex justify-end gap-3" style={{ background: 'rgba(60,36,21,0.05)' }}>
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-lg text-sm text-stone-600 hover:bg-stone-100"
          >
            取消
          </button>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-6 py-2 rounded-lg text-white text-sm font-medium"
            style={{ background: 'linear-gradient(135deg, #C49A3F, #A07C2E)' }}
          >
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
