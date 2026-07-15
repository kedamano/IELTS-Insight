import { useState, useCallback, useRef } from 'react';

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const durationRef = useRef<number>(0);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunks.current = [];
    mr.ondataavailable = e => chunks.current.push(e.data);
    mr.start();
    mediaRecorder.current = mr;
    setRecording(true);
    durationRef.current = 0;
    setDuration(0);
    timer.current = window.setInterval(() => {
      durationRef.current += 100;
      setDuration(durationRef.current);
    }, 100);
  }, []);

  const stop = useCallback((): Promise<{ blob: Blob; durationMs: number }> => {
    return new Promise(resolve => {
      const mr = mediaRecorder.current!;
      mr.onstop = () => {
        setRecording(false);
        clearInterval(timer.current);
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
        }
        resolve({ blob, durationMs: durationRef.current });
      };
      mr.stop();
    });
  }, []);

  return { recording, duration, start, stop };
}
