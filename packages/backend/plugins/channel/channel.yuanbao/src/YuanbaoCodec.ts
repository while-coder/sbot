import { randomBytes, randomUUID } from 'node:crypto';
import { Field, Root, Type } from 'protobufjs';

export interface ConnHead {
  cmdType: number;
  cmd: string;
  seqNo: number;
  msgId: string;
  module: string;
  needAck?: boolean;
  status?: number;
}

export interface ConnMessage {
  head: ConnHead;
  data: Buffer;
}

export interface YuanbaoMessageElement {
  msgType: string;
  msgContent: {
    text?: string;
    uuid?: string;
    imageFormat?: number;
    data?: string;
    desc?: string;
    imageInfoArray?: Array<{ type: number; size: number; width: number; height: number; url: string }>;
    url?: string;
    fileSize?: number;
    fileName?: string;
  };
}

const root = new Root();

function type(name: string, fields: Array<[string, number, string, 'repeated'?]>): Type {
  const value = new Type(name);
  for (const [fieldName, id, fieldType, rule] of fields) {
    value.add(new Field(fieldName, id, fieldType, rule));
  }
  return value;
}

const conn = root.define('trpc.yuanbao.conn_common');
conn.add(type('Head', [
  ['cmdType', 1, 'uint32'], ['cmd', 2, 'string'], ['seqNo', 3, 'uint32'],
  ['msgId', 4, 'string'], ['module', 5, 'string'], ['needAck', 6, 'bool'],
  ['status', 10, 'int32'],
]));
conn.add(type('ConnMsg', [['head', 1, 'Head'], ['data', 2, 'bytes']]));
conn.add(type('AuthInfo', [['uid', 1, 'string'], ['source', 2, 'string'], ['token', 3, 'string']]));
conn.add(type('DeviceInfo', [['instanceId', 10, 'string']]));
conn.add(type('AuthBindReq', [
  ['bizId', 1, 'string'], ['authInfo', 2, 'AuthInfo'], ['deviceInfo', 3, 'DeviceInfo'],
  ['envName', 5, 'string'], ['bindMode', 6, 'uint32'], ['forceToken', 7, 'string'],
]));
conn.add(type('AuthBindRsp', [
  ['code', 1, 'int32'], ['message', 2, 'string'], ['connectId', 3, 'string'],
  ['timestamp', 4, 'uint64'], ['clientIp', 5, 'string'],
]));
conn.add(type('PingReq', []));
conn.add(type('PingRsp', [['heartInterval', 1, 'uint32'], ['timestamp', 2, 'uint64']]));
conn.add(type('KickoutMsg', [['status', 1, 'int32'], ['reason', 2, 'string'], ['otherDeviceName', 3, 'string']]));

const biz = root.define('trpc.yuanbao.yuanbao_conn.yuanbao_openclaw_proxy');
biz.add(type('ImImageInfoArray', [
  ['type', 1, 'uint32'], ['size', 2, 'uint32'], ['width', 3, 'uint32'],
  ['height', 4, 'uint32'], ['url', 5, 'string'],
]));
biz.add(type('MsgContent', [
  ['text', 1, 'string'], ['uuid', 2, 'string'], ['imageFormat', 3, 'uint32'],
  ['data', 4, 'string'], ['desc', 5, 'string'], ['imageInfoArray', 8, 'ImImageInfoArray', 'repeated'],
  ['url', 10, 'string'], ['fileSize', 11, 'uint32'], ['fileName', 12, 'string'],
]));
biz.add(type('MsgBodyElement', [['msgType', 1, 'string'], ['msgContent', 2, 'MsgContent']]));
biz.add(type('SendC2CMessageReq', [
  ['msgId', 1, 'string'], ['toAccount', 2, 'string'], ['fromAccount', 3, 'string'],
  ['msgRandom', 4, 'uint32'], ['msgBody', 5, 'MsgBodyElement', 'repeated'],
  ['groupCode', 6, 'string'], ['msgSeq', 7, 'uint64'],
]));
biz.add(type('SendGroupMessageReq', [
  ['msgId', 1, 'string'], ['groupCode', 2, 'string'], ['fromAccount', 3, 'string'],
  ['toAccount', 4, 'string'], ['random', 5, 'string'],
  ['msgBody', 6, 'MsgBodyElement', 'repeated'], ['refMsgId', 7, 'string'], ['msgSeq', 8, 'uint64'],
]));
biz.add(type('SendPrivateHeartbeatReq', [
  ['fromAccount', 1, 'string'], ['toAccount', 2, 'string'], ['heartbeat', 3, 'int32'],
]));
biz.add(type('SendGroupHeartbeatReq', [
  ['fromAccount', 1, 'string'], ['toAccount', 2, 'string'], ['groupCode', 3, 'string'],
  ['sendTime', 4, 'int64'], ['heartbeat', 5, 'int32'],
]));
root.resolveAll();

const CONN_MSG = 'trpc.yuanbao.conn_common.ConnMsg';
const AUTH_BIND_REQ = 'trpc.yuanbao.conn_common.AuthBindReq';
const AUTH_BIND_RSP = 'trpc.yuanbao.conn_common.AuthBindRsp';
const PING_REQ = 'trpc.yuanbao.conn_common.PingReq';
const PING_RSP = 'trpc.yuanbao.conn_common.PingRsp';
const KICKOUT_MSG = 'trpc.yuanbao.conn_common.KickoutMsg';
const BIZ = 'trpc.yuanbao.yuanbao_conn.yuanbao_openclaw_proxy';

export const CMD_TYPE_REQUEST = 0;
export const CMD_TYPE_RESPONSE = 1;
export const CMD_TYPE_PUSH = 2;
export const CMD_TYPE_PUSH_ACK = 3;
export const CMD_AUTH_BIND = 'auth-bind';
export const CMD_PING = 'ping';
export const CMD_KICKOUT = 'kickout';

let seq = 0;

function nextSeq(): number {
  seq = (seq + 1) % 0x80000000;
  return seq;
}

function messageId(): string {
  return randomUUID().replace(/-/g, '');
}

function randomUint32(): number {
  return randomBytes(4).readUInt32BE(0);
}

function encode(typeName: string, value: Record<string, unknown>): Buffer {
  const messageType = root.lookupType(typeName);
  const error = messageType.verify(value);
  if (error) throw new Error(`${typeName}: ${error}`);
  return Buffer.from(messageType.encode(messageType.create(value)).finish());
}

function decode(typeName: string, data: Uint8Array): any {
  const messageType = root.lookupType(typeName);
  return messageType.toObject(messageType.decode(data), {
    longs: String,
    bytes: Buffer,
    defaults: false,
  });
}

function encodeConn(head: ConnHead, data?: Buffer): Buffer {
  return encode(CONN_MSG, data?.length ? { head, data } : { head });
}

export function decodeConn(raw: Uint8Array): ConnMessage {
  const decoded = decode(CONN_MSG, raw);
  return {
    head: decoded.head as ConnHead,
    data: decoded.data ? Buffer.from(decoded.data) : Buffer.alloc(0),
  };
}

export function buildAuthBindMessage(uid: string, source: string, token: string): Buffer {
  const data = encode(AUTH_BIND_REQ, {
    bizId: 'ybBot',
    authInfo: { uid, source, token },
    deviceInfo: { instanceId: '16' },
  });
  return encodeConn({
    cmdType: CMD_TYPE_REQUEST, cmd: CMD_AUTH_BIND, seqNo: nextSeq(),
    msgId: messageId(), module: 'conn_access',
  }, data);
}

export function buildPingMessage(): Buffer {
  return encodeConn({
    cmdType: CMD_TYPE_REQUEST, cmd: CMD_PING, seqNo: nextSeq(),
    msgId: messageId(), module: 'conn_access',
  }, encode(PING_REQ, {}));
}

export function buildPushAck(head: ConnHead): Buffer {
  return encodeConn({
    cmdType: CMD_TYPE_PUSH_ACK,
    cmd: head.cmd,
    seqNo: nextSeq(),
    msgId: head.msgId,
    module: head.module,
  });
}

function buildBusinessMessage(cmd: string, data: Buffer): Buffer {
  return encodeConn({
    cmdType: CMD_TYPE_REQUEST, cmd, seqNo: nextSeq(),
    msgId: messageId(), module: 'yuanbao_openclaw_proxy',
  }, data);
}

export function buildSendMessage(
  chatType: 'c2c' | 'group',
  targetId: string,
  fromAccount: string,
  elements: YuanbaoMessageElement[],
): Buffer {
  if (chatType === 'group') {
    return buildBusinessMessage('send_group_message', encode(`${BIZ}.SendGroupMessageReq`, {
      groupCode: targetId,
      fromAccount,
      random: String(randomUint32()),
      msgBody: elements,
    }));
  }
  return buildBusinessMessage('send_c2c_message', encode(`${BIZ}.SendC2CMessageReq`, {
    toAccount: targetId,
    fromAccount,
    msgRandom: randomUint32(),
    msgBody: elements,
  }));
}

export function buildTypingMessage(
  chatType: 'c2c' | 'group',
  targetId: string,
  fromAccount: string,
  senderId: string,
  heartbeat: 1 | 2,
): Buffer {
  if (chatType === 'group') {
    return buildBusinessMessage('send_group_heartbeat', encode(`${BIZ}.SendGroupHeartbeatReq`, {
      fromAccount, toAccount: senderId, groupCode: targetId, sendTime: 0, heartbeat,
    }));
  }
  return buildBusinessMessage('send_private_heartbeat', encode(`${BIZ}.SendPrivateHeartbeatReq`, {
    fromAccount, toAccount: targetId, heartbeat,
  }));
}

export const decodeAuthBindResponse = (data: Uint8Array): any => decode(AUTH_BIND_RSP, data);
export const decodePingResponse = (data: Uint8Array): any => decode(PING_RSP, data);
export const decodeKickoutMessage = (data: Uint8Array): any => decode(KICKOUT_MSG, data);
