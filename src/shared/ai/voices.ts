import { LLMProviderType } from '@shared/types';

export type VoiceSpeedSupport = 'yes' | 'no' | 'unknown';

export interface VoiceOption {
  id: string;
  label: string;
  hint?: string;
}

export interface VoiceProfile {
  id: 'openai' | 'gemini' | 'piper' | 'kokoro' | 'generic';
  label: string;
  defaultVoice: string;
  voices: readonly VoiceOption[];
  supportsSpeed: VoiceSpeedSupport;
}

const OPENAI_VOICES: readonly VoiceOption[] = [
  { id: 'alloy', label: 'Alloy' },
  { id: 'ash', label: 'Ash' },
  { id: 'ballad', label: 'Ballad' },
  { id: 'coral', label: 'Coral' },
  { id: 'echo', label: 'Echo' },
  { id: 'fable', label: 'Fable' },
  { id: 'nova', label: 'Nova' },
  { id: 'onyx', label: 'Onyx' },
  { id: 'sage', label: 'Sage' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'verse', label: 'Verse' },
];

const GEMINI_VOICES: readonly VoiceOption[] = [
  { id: 'Zephyr', label: 'Zephyr', hint: 'Bright' },
  { id: 'Puck', label: 'Puck', hint: 'Upbeat' },
  { id: 'Charon', label: 'Charon', hint: 'Informative' },
  { id: 'Kore', label: 'Kore', hint: 'Firm' },
  { id: 'Fenrir', label: 'Fenrir', hint: 'Excitable' },
  { id: 'Leda', label: 'Leda', hint: 'Youthful' },
  { id: 'Orus', label: 'Orus', hint: 'Firm' },
  { id: 'Aoede', label: 'Aoede', hint: 'Breezy' },
  { id: 'Callirrhoe', label: 'Callirrhoe', hint: 'Easy-going' },
  { id: 'Autonoe', label: 'Autonoe', hint: 'Bright' },
  { id: 'Enceladus', label: 'Enceladus', hint: 'Breathy' },
  { id: 'Iapetus', label: 'Iapetus', hint: 'Clear' },
  { id: 'Umbriel', label: 'Umbriel', hint: 'Easy-going' },
  { id: 'Algieba', label: 'Algieba', hint: 'Smooth' },
  { id: 'Despina', label: 'Despina', hint: 'Smooth' },
  { id: 'Erinome', label: 'Erinome', hint: 'Clear' },
  { id: 'Algenib', label: 'Algenib', hint: 'Gravelly' },
  { id: 'Rasalgethi', label: 'Rasalgethi', hint: 'Informative' },
  { id: 'Laomedeia', label: 'Laomedeia', hint: 'Upbeat' },
  { id: 'Achernar', label: 'Achernar', hint: 'Soft' },
  { id: 'Alnilam', label: 'Alnilam', hint: 'Firm' },
  { id: 'Schedar', label: 'Schedar', hint: 'Even' },
  { id: 'Gacrux', label: 'Gacrux', hint: 'Mature' },
  { id: 'Pulcherrima', label: 'Pulcherrima', hint: 'Forward' },
  { id: 'Achird', label: 'Achird', hint: 'Friendly' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi', hint: 'Casual' },
  { id: 'Vindemiatrix', label: 'Vindemiatrix', hint: 'Gentle' },
  { id: 'Sadachbia', label: 'Sadachbia', hint: 'Lively' },
  { id: 'Sadaltager', label: 'Sadaltager', hint: 'Knowledgeable' },
  { id: 'Sulafat', label: 'Sulafat', hint: 'Warm' },
];

const PIPER_VOICES: readonly VoiceOption[] = [
  { id: 'female', label: 'Female', hint: 'Piper default' },
  { id: 'male', label: 'Male', hint: 'Piper default' },
];

const KOKORO_VOICES: readonly VoiceOption[] = [
  { id: 'af_sky', label: 'af_sky', hint: 'US female' },
  { id: 'af_bella', label: 'af_bella', hint: 'US female' },
  { id: 'af_heart', label: 'af_heart', hint: 'US female' },
  { id: 'af_nicole', label: 'af_nicole', hint: 'US female' },
  { id: 'af_sarah', label: 'af_sarah', hint: 'US female' },
  { id: 'am_adam', label: 'am_adam', hint: 'US male' },
  { id: 'am_michael', label: 'am_michael', hint: 'US male' },
  { id: 'bf_emma', label: 'bf_emma', hint: 'UK female' },
  { id: 'bm_george', label: 'bm_george', hint: 'UK male' },
];

const OPENAI_PROFILE: VoiceProfile = {
  id: 'openai',
  label: 'OpenAI-compatible',
  defaultVoice: 'alloy',
  voices: OPENAI_VOICES,
  supportsSpeed: 'unknown',
};

const GEMINI_PROFILE: VoiceProfile = {
  id: 'gemini',
  label: 'Gemini',
  defaultVoice: 'Kore',
  voices: GEMINI_VOICES,
  supportsSpeed: 'no',
};

const PIPER_PROFILE: VoiceProfile = {
  id: 'piper',
  label: 'Piper',
  defaultVoice: 'female',
  voices: PIPER_VOICES,
  supportsSpeed: 'unknown',
};

const KOKORO_PROFILE: VoiceProfile = {
  id: 'kokoro',
  label: 'Kokoro',
  defaultVoice: 'af_sky',
  voices: KOKORO_VOICES,
  supportsSpeed: 'yes',
};

const GENERIC_PROFILE: VoiceProfile = {
  id: 'generic',
  label: 'OpenAI-compatible',
  defaultVoice: 'alloy',
  voices: [],
  supportsSpeed: 'unknown',
};

const OPENAI_COMPATIBLE_TYPES: ReadonlySet<LLMProviderType> = new Set([
  LLMProviderType.OPENAI,
  LLMProviderType.GROQ,
  LLMProviderType.TOGETHER,
  LLMProviderType.FIREWORKS,
]);

export interface VoiceProfileTarget {
  providerType?: LLMProviderType;
  modelId?: string;
  apiBase?: string;
}

export function resolveVoiceProfile(target: VoiceProfileTarget): VoiceProfile {
  const haystack = `${target.modelId ?? ''} ${target.apiBase ?? ''}`;
  if (/kokoro/i.test(haystack)) {
    return KOKORO_PROFILE;
  }
  if (target.providerType === LLMProviderType.GOOGLE) {
    return GEMINI_PROFILE;
  }
  if (target.providerType === LLMProviderType.OLLAMA) {
    return PIPER_PROFILE;
  }
  if (target.providerType !== undefined && OPENAI_COMPATIBLE_TYPES.has(target.providerType)) {
    return {
      ...OPENAI_PROFILE,
      supportsSpeed: /^tts-1(-hd)?$/i.test(target.modelId ?? '') ? 'yes' : 'unknown',
    };
  }
  return GENERIC_PROFILE;
}
