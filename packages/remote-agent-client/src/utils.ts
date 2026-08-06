/** 回环地址：sbot 和界面在同一台机器上。 */
const LOOPBACK_HOSTS = new Set(["localhost", "::1", "[::1]", "0.0.0.0"]);

/** HTTP 传输的根地址；允许带路径前缀，便于挂在反向代理下。 */
export function normalizeBaseUrl(value: string): string {
  const url = parseUrl(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("sbot 地址必须使用 http:// 或 https://");
  return trimUrl(url);
}

/** WebSocket 传输的地址；顺手接受 http(s)，按同源规则换成 ws(s)。 */
export function normalizeSocketUrl(value: string): string {
  const url = parseUrl(value);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("sbot 地址必须使用 ws:// 或 wss://");
  return trimUrl(url);
}

/**
 * 判断 sbot 是否跑在打开界面的这台机器上，用来提示「sbot 自己读工作目录」这条通道能不能用。
 * 浏览器读不到本机网卡 IP，所以只认两种情形：回环地址，以及和界面同一个主机名/IP
 * （界面从 http://192.168.1.7 打开、sbot 也填这个 IP 时成立）。其余一律按远端算。
 * 端口映射、反向代理、WSL 都会让这个结论失真，所以它只用于提示，不拿来自动改配置。
 */
export function isLocalAgentHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost")) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  const pageHost = typeof location === "undefined" ? "" : location.hostname.toLowerCase();
  return pageHost.length > 0 && host === pageHost;
}

function parseUrl(value: string): URL {
  const text = value.trim();
  if (!text) throw new Error("sbot 地址不能为空");
  return new URL(text);
}

function trimUrl(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
