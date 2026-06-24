import http from "http";

/** 检测本地 sbot 服务是否在指定端口运行 */
export function isServiceRunning(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const req = http.get(`http://localhost:${port}/`, () => resolve(true));
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

/** 请求本地 sbot 服务关闭，返回是否成功 */
export function shutdownService(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const req = http.request(`http://localhost:${port}/api/shutdown`, { method: 'POST' }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(5000, () => { req.destroy(); resolve(false); });
        req.end();
    });
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
