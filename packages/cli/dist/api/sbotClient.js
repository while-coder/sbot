import nodeHttp from 'node:http';
import readline from 'node:readline';
import axios from 'axios';
export class SbotClient {
    http;
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.http = axios.create({ baseURL: baseUrl });
    }
    async isOnline() {
        try {
            await this.http.get('/api/settings', { timeout: 3000 });
            return true;
        }
        catch {
            return false;
        }
    }
    async fetchSettings() {
        const res = await this.http.get('/api/settings');
        return res.data.data;
    }
    async *chatStream(query, agentId, saveId, memoryId, signal) {
        const workPath = process.cwd();
        const body = JSON.stringify({ query, agentId, saveId, memoryId, workPath });
        const url = new URL(`${this.baseUrl}/api/chat`);
        const res = await new Promise((resolve, reject) => {
            const req = nodeHttp.request({
                hostname: url.hostname,
                port: parseInt(url.port) || 80,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            }, resolve);
            req.on('error', reject);
            signal.addEventListener('abort', () => req.destroy(new Error('AbortError')), { once: true });
            req.write(body);
            req.end();
        });
        if (res.statusCode !== 200) {
            throw new Error(`Chat request failed: ${res.statusCode}`);
        }
        const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.startsWith('data: '))
                continue;
            try {
                const event = JSON.parse(line.slice(6));
                yield event;
                if (event.type === 'done')
                    return;
            }
            catch {
                // skip malformed JSON
            }
        }
    }
}
//# sourceMappingURL=sbotClient.js.map