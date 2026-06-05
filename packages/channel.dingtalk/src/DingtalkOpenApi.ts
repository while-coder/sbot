import axios from 'axios';
import type { ILogger } from 'channel.base';

const ACCESS_TOKEN_URL  = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const GROUP_SEND_URL    = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send';
const OTO_BATCH_URL     = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';

const TOKEN_LEEWAY_SEC  = 300;     // 提前 5 分钟刷新
const REQUEST_TIMEOUT_MS = 15000;

export class DingtalkOpenApi {
  private token = '';
  private tokenExpireAt = 0;
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly logger?: ILogger,
  ) {}

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpireAt) return this.token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const resp = await axios.post(ACCESS_TOKEN_URL, {
          appKey: this.clientId,
          appSecret: this.clientSecret,
        }, { timeout: REQUEST_TIMEOUT_MS });
        const accessToken = resp.data?.accessToken;
        const expireIn = Number(resp.data?.expireIn ?? 7200);
        if (!accessToken) throw new Error(`bad token response: ${JSON.stringify(resp.data)}`);
        this.token = accessToken;
        this.tokenExpireAt = Date.now() + Math.max(60_000, (expireIn - TOKEN_LEEWAY_SEC) * 1000);
        return accessToken;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async sendMarkdownToGroup(openConversationId: string, title: string, text: string): Promise<void> {
    await this.callOpenApi(GROUP_SEND_URL, {
      robotCode: this.clientId, openConversationId,
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title, text }),
    });
  }

  async sendMarkdownToUser(userIds: string[], title: string, text: string): Promise<void> {
    await this.callOpenApi(OTO_BATCH_URL, {
      robotCode: this.clientId, userIds,
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title, text }),
    });
  }

  private async callOpenApi(url: string, body: any, retried = false): Promise<void> {
    const token = await this.getToken();
    try {
      await axios.post(url, body, {
        headers: {
          'x-acs-dingtalk-access-token': token,
          'Content-Type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch (e: any) {
      const status = e.response?.status;
      if (status === 401 && !retried) {
        this.token = '';
        this.tokenExpireAt = 0;
        return this.callOpenApi(url, body, true);
      }
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      this.logger?.error(`Dingtalk OpenAPI ${url} failed: ${status ?? '-'} ${detail}`);
      throw new Error(`DingTalk OpenAPI ${url}: ${status ?? '-'} ${detail}`);
    }
  }
}
