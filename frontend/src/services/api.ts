const BASE_URL = "http://127.0.0.1:8765/api";

export interface DialogueItem {
  seq: number;
  speaker: string;
  role: string;
  en: string;
  zh: string;
  keywords?: string[];
  tips?: string;
}

export interface SceneListItem {
  id: string;
  title: string;
  difficulty: number;
  category: string;
  is_free: boolean;
  dialogue_count: number;
}

export interface Scene extends SceneListItem {
  dialogues: DialogueItem[];
  cultural_notes: string;
}

export interface ScoreResult {
  pronunciation_score: number;
  fluency_score: number;
  completeness_score: number;
  overall_score: number;
  word_scores: { word: string; status: string }[];
  feedback: string;
  ai_tip?: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  getScenes: () => fetchJson<{ data: SceneListItem[] }>(`${BASE_URL}/scenes`).then(r => r.data),
  getScene: (id: string) => fetchJson<{ data: Scene }>(`${BASE_URL}/scenes/${id}`).then(r => r.data),
  getTTSUrl: (text: string, voice = "en-US") =>
    `${BASE_URL}/tts?text=${encodeURIComponent(text)}&voice=${voice}`,
  transcribe: async (blob: Blob) => {
    const form = new FormData();
    form.append("audio", blob, "speech.webm");
    return fetchJson<{ data: { text: string; confidence: number } }>(`${BASE_URL}/stt`, {
      method: "POST",
      body: form,
    }).then(r => r.data);
  },
  score: async (original: string, userText: string, durationMs: number) => {
    const form = new FormData();
    form.append("original", original);
    form.append("user_transcription", userText);
    form.append("duration_ms", String(durationMs));
    const res = await fetchJson<{ data: ScoreResult }>(`${BASE_URL}/score`, {
      method: "POST",
      body: form,
    });
    return res.data;
  },
};
