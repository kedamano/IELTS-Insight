const BASE_URL = "http://127.0.0.1:8765/api";

// ============================================================
// Type Definitions
// ============================================================

export interface WordItem {
  word: string;
  phonetic: string;
  zh: string;
  difficulty: number;
}

export interface DialogueItem {
  seq: number;
  speaker: string;
  role: string;
  en: string;
  zh: string;
  keywords?: string[];
  tips?: string;
  words?: WordItem[];  // v1.1 新增
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

export interface WordScore {
  word: string;
  score: number;
  status: string;      // "correct" | "wrong" | "missing" | "extra"
  error_type?: string;
  tip?: string;
}

export interface ScoreResult {
  pronunciation_score: number;
  fluency_score: number;
  completeness_score: number;
  overall_score: number;
  word_scores: WordScore[];
  feedback: string;
  ai_tip?: string;
}

export interface WordInfo {
  word: string;
  phonetic: string;
  zh: string;
  difficulty: number;
  examples: string[];
  source: string;
  pronunciation_tips?: { phoneme: string; tip: string }[];
}

export interface WrongRecord {
  id: number;
  scene_id: string;
  sentence_seq: number;
  word: string;
  phonetic_expected: string;
  phonetic_actual: string;
  error_type: string;
  score: number;
  mastered: boolean;
  consecutive_pass: number;
  created_at: string;
}

export interface WrongStats {
  total_wrong: number;
  active_wrong: number;
  mastered: number;
  top_phonemes: { phoneme: string; count: number }[];
}

export interface LearningStats {
  today: { duration_minutes: number; sentences_count: number; avg_score: number };
  week: { duration_minutes: number; sentences_count: number; avg_score: number };
  trend: { date: string; score: number; sentences: number }[];
  streak: number;
  top_errors: { phoneme: string; count: number }[];
  grade: { level: number; name: string; description: string };
  achievements: { id: string; name: string; icon: string; desc: string; condition: boolean }[];
}

export interface PhonemeTip {
  phoneme: string;
  tip: string;
}

// --- v1.5 Types ---
export interface WordbookItem {
  id: number;
  word: string;
  phonetic: string;
  zh: string;
  example: string;
  created_at: string;
}

export interface SentenceParseResult {
  sentence: string;
  phonetic: string;
  words: { word: string; phonetic: string; zh: string }[];
  expressions: { expression: string; zh: string }[];
  cultural_note: string;
  source: string;
}

export interface Settings {
  practice_mode: 'normal' | 'shadowing';
  shadowing_delay: number;
  playback_speed: number;
  tts_voice: 'en-US' | 'en-GB';
  online_enabled: boolean;
}

// ============================================================
// API Client
// ============================================================

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  // --- Scenes ---
  getScenes: () =>
    fetchJson<{ data: SceneListItem[] }>(`${BASE_URL}/scenes`).then((r) => r.data),
  getScene: (id: string) =>
    fetchJson<{ data: Scene }>(`${BASE_URL}/scenes/${id}`).then((r) => r.data),

  // --- TTS ---
  getTTSUrl: (text: string, voice = "en-US") =>
    `${BASE_URL}/tts?text=${encodeURIComponent(text)}&voice=${voice}`,

  // --- STT ---
  transcribe: async (blob: Blob) => {
    const form = new FormData();
    form.append("audio", blob, "speech.webm");
    return fetchJson<{ data: { text: string; confidence: number } }>(`${BASE_URL}/stt`, {
      method: "POST",
      body: form,
    }).then((r) => r.data);
  },

  // --- Score ---
  score: async (original: string, userText: string, durationMs: number) => {
    const form = new FormData();
    form.append("original", original);
    form.append("user_transcription", userText);
    form.append("duration_ms", String(durationMs));
    return fetchJson<{ data: ScoreResult }>(`${BASE_URL}/score`, {
      method: "POST",
      body: form,
    }).then((r) => r.data);
  },

  // --- v1.1: Word ---
  getWordInfo: (word: string) =>
    fetchJson<{ data: WordInfo }>(`${BASE_URL}/word/${encodeURIComponent(word)}`).then(
      (r) => r.data
    ),

  getPhonemeTip: (phoneme: string) =>
    fetchJson<{ data: PhonemeTip }>(
      `${BASE_URL}/phoneme-tip/${encodeURIComponent(phoneme)}`
    ).then((r) => r.data),

  // --- v1.1: Wrong Records ---
  getWrongRecords: (sceneId?: string, mastered?: boolean) => {
    const params = new URLSearchParams();
    if (sceneId) params.set("scene_id", sceneId);
    if (mastered !== undefined) params.set("mastered", String(mastered));
    return fetchJson<{ data: WrongRecord[]; total: number }>(
      `${BASE_URL}/wrong-records?${params}`
    ).then((r) => r.data);
  },

  getWrongStats: () =>
    fetchJson<{ data: WrongStats }>(`${BASE_URL}/wrong-records/stats`).then((r) => r.data),

  markWrongMastered: async (word: string, sceneId?: string) => {
    const form = new FormData();
    form.append("word", word);
    if (sceneId) form.append("scene_id", sceneId);
    return fetchJson<{ data: { success: boolean } }>(
      `${BASE_URL}/wrong-records/mark-mastered`,
      { method: "POST", body: form }
    );
  },

  // --- v1.1: Learning Stats ---
  getLearningStats: () =>
    fetchJson<{ data: LearningStats }>(`${BASE_URL}/learning-stats`).then((r) => r.data),

  getAchievements: () =>
    fetchJson<{ data: LearningStats["achievements"] }>(`${BASE_URL}/achievements`).then(
      (r) => r.data
    ),

  // --- Payment ---
  getPaymentOrder: () =>
    fetchJson<{ data: { order_id: string } }>(`${BASE_URL}/payment/order`).then((r) => r.data),
  verifyPayment: async (receipt: string) => {
    const form = new FormData();
    form.append("receipt", receipt);
    return fetchJson<{ data: { valid: boolean; expire_at: string; message: string } }>(
      `${BASE_URL}/payment/verify`,
      { method: "POST", body: form }
    ).then((r) => r.data);
  },

  // --- v1.5: WordBook ---
  getWordbook: () =>
    fetchJson<{ data: WordbookItem[] }>(`${BASE_URL}/wordbook`).then((r) => r.data),

  addToWordbook: async (word: string, phonetic = "", zh = "", example = "") => {
    const form = new FormData();
    form.append("word", word);
    form.append("phonetic", phonetic);
    form.append("zh", zh);
    form.append("example", example);
    return fetchJson<{ data: WordbookItem }>(`${BASE_URL}/wordbook/add`, {
      method: "POST",
      body: form,
    });
  },

  removeFromWordbook: (word: string) =>
    fetchJson<{ data: { success: boolean } }>(`${BASE_URL}/wordbook/${encodeURIComponent(word)}`, {
      method: "DELETE",
    }),

  // --- v1.5: Sentence Parse ---
  getSentenceParse: async (sceneId: string, seq: number) =>
    fetchJson<{ data: SentenceParseResult }>(
      `${BASE_URL}/sentence-parse/${sceneId}/${seq}`
    ).then((r) => r.data),

  // --- v1.5: Settings ---
  getSettings: () =>
    fetchJson<{ data: Settings }>(`${BASE_URL}/settings`).then((r) => r.data),

  updateSettings: async (settings: Partial<Settings>) => {
    const form = new FormData();
    if (settings.practice_mode) form.append("practice_mode", settings.practice_mode);
    if (settings.shadowing_delay !== undefined)
      form.append("shadowing_delay", String(settings.shadowing_delay));
    if (settings.playback_speed !== undefined)
      form.append("playback_speed", String(settings.playback_speed));
    if (settings.tts_voice) form.append("tts_voice", settings.tts_voice);
    if (settings.online_enabled !== undefined)
      form.append("online_enabled", settings.online_enabled ? "true" : "false");
    return fetchJson<{ data: Settings }>(`${BASE_URL}/settings`, {
      method: "POST",
      body: form,
    });
  },
};
