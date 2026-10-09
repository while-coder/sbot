/**
 * Scratchpad 限制常量。所有大小限制按 UTF-8 字节计（Buffer.byteLength）——
 * 中文一个字符 3 字节，按字符数限会让单条实际体积失控。
 */

/** key 最大长度（字符数）；内容字符白名单见 ScratchpadStore.isValidKey。 */
export const SCRATCHPAD_MAX_KEY_CHARS = 64;

/** 单条 content 最大字节数。 */
export const SCRATCHPAD_MAX_ENTRY_BYTES = 8 * 1024;

/** 全会话 entries 总字节数上限。 */
export const SCRATCHPAD_MAX_TOTAL_BYTES = 64 * 1024;

/** 全会话条目数上限。 */
export const SCRATCHPAD_MAX_ENTRIES = 50;

/** 会话文件 TTL：超过该时长未被写入的板在启动清扫/写入时被清掉。 */
export const SCRATCHPAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** read_scratchpad 无 key 列表时，单条内容的预览字节数。 */
export const SCRATCHPAD_PREVIEW_BYTES = 200;

/** dynamic prompt 条目列表的最大展示条数，超出折叠为 "(…and N more)"。 */
export const SCRATCHPAD_MENU_MAX_ENTRIES = 20;
