import { HttpAgentTransport } from "./HttpAgentTransport.js";
import { WsAgentTransport } from "./WsAgentTransport.js";
import { transportKind, type RemoteAgentTransport, type TransportOptions } from "./transport.js";

/** 按 url 协议（或显式的 transport 选项）挑传输实现：http(s) 走 SSE，ws(s) 走长连接。 */
export function createTransport(options: TransportOptions): RemoteAgentTransport {
  return transportKind(options) === "websocket" ? new WsAgentTransport(options) : new HttpAgentTransport(options);
}
