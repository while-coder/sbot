export interface MiAccount {
  userId: string;
  password: string;
  passToken?: string;
  serviceToken?: string;
  deviceId?: string;
}

export interface MiNADevice {
  deviceID: string;
  miotDID: string;
  name: string;
  alias: string;
  hardware: string;
  serialNumber: string;
  mac: string;
}

export interface MiConversation {
  query: string;
  time: number;
  answers: Array<{
    type: string;
    tts?: string;
    url?: string;
  }>;
}

export interface MiConversations {
  records: MiConversation[];
  hasMore: boolean;
  nextEndTime?: number;
}

export interface AuthedAccount {
  userId: string;
  serviceToken: string;
  deviceId: string;
}
