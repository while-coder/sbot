// iLink Bot API type definitions
// Ported from mcp-wechat-server

export const WechatMessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

export const WechatMessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const WechatMessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export interface TextItem {
  text?: string;
}

export interface VoiceItem {
  text?: string;
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

export interface FileItem {
  file_name?: string;
  media?: CDNMedia;
  md5?: string;
  len?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  aeskey?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_width?: number;
  thumb_height?: number;
  hd_size?: number;
  url?: string;
}

export interface RefMessage {
  message_item?: WechatMessageItem;
  title?: string;
}

export interface WechatMessageItem {
  type?: number;
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  image_item?: ImageItem;
}

/** media_type values for getuploadurl */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export interface GetUploadUrlReq {
  filekey: string;
  media_type: number;
  to_user_id: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  no_need_thumb?: boolean;
  aeskey: string;
  base_info?: { channel_version: string };
}

export interface GetUploadUrlResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  upload_param?: string;
  thumb_upload_param?: string;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  message_type?: number;
  message_state?: number;
  item_list?: WechatMessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  status?: number;
}

export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

/** Credentials stored in sbot config */
export interface WechatCredentials {
  botToken: string;
  botId: string;
  userId: string;
  baseUrl: string;
}

// --- QR Login ---

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QRStatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}
