import { useState, useCallback, useRef } from 'react';
import { api } from '../services/api';

export function useTTS() {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(async (text: string, voice = "en-US") => {
    if (playing) return;
    setPlaying(true);
    const url = api.getTTSUrl(text, voice);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    await audio.play();
  }, [playing]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  return { playing, play, stop };
}
