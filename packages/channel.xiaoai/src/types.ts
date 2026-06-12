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

export interface AuthedAccount {
  userId: string;
  serviceToken: string;
  deviceId: string;
}
