export interface MiNADevice {
  deviceID: string;
  miotDID: string;
  name: string;
  alias: string;
  hardware: string;
}

export interface MiConversation {
  query: string;
  time: number;
  /** 只取 type 过滤 TTS/LLM 回答；tts 文本与音频 url 用不到 */
  answers: Array<{ type: string }>;
}

export interface AuthedAccount {
  userId: string;
  serviceToken: string;
  deviceId: string;
}
