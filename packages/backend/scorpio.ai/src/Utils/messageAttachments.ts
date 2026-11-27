import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ContentPartType, MessageRole, type AttachmentInput, type ContentPart, type IAgentSaverService, type MessageContent } from "scorpio.saver";
import { detectImageMimeType, detectMediaType, resizeImageIfNeeded } from "./contentUtils";
import { createImageContent } from "../Tools/Core/mcp";

type IncomingAttachment = AttachmentInput & { sourcePath?: string; asAudio?: boolean };

interface SavedAttachment {
    type: "attachment";
    name: string;
    filePath: string;
    mimeType: string;
    asAudio?: boolean;
}

function isSavedAttachment(part: ContentPart): part is SavedAttachment {
    return part.type === "attachment" && typeof part.filePath === "string" &&
        typeof part.name === "string" && typeof part.mimeType === "string";
}

function attachmentName(name: string): string {
    return name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "attachment";
}

/** For server-side channel adapters that have already downloaded a file. */
export function incomingFileAttachment(sourcePath: string, name = path.basename(sourcePath)): ContentPart {
    return { type: "incoming_attachment", upload: { name, sourcePath } };
}

/** For channel adapters that already have the original bytes in memory. */
export function incomingBufferAttachment(name: string, bytes: Buffer, mimeType = detectMediaType(name).mimeType): ContentPart {
    return { type: "incoming_attachment", upload: { name, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` } };
}

/** Accepts wire attachments while discarding any client-supplied internal references. */
export function appendIncomingAttachments(content: MessageContent, attachments?: readonly AttachmentInput[]): MessageContent {
    const parts: ContentPart[] = typeof content === "string"
        ? (content.trim() ? [{ type: "text", text: content }] : [])
        : content.filter(part => part && typeof part.type === "string" &&
            part.type !== "attachment" && part.type !== "incoming_attachment");
    for (const item of Array.isArray(attachments) ? attachments : []) {
        if (!item || typeof item.name !== "string") continue;
        const { name, dataUrl, content } = item;
        if (typeof dataUrl === "string" || typeof content === "string") {
            parts.push({ type: "incoming_attachment", upload: { name, dataUrl, content } });
        }
    }
    return parts.every((part): part is Extract<ContentPart, { type: "text" }> => part.type === ContentPartType.Text)
        ? parts.map(part => part.text).join("\n")
        : parts;
}

export function previewIncomingAttachments(content: MessageContent, includeImages = true): MessageContent {
    if (typeof content === "string") return content;
    return content.map(part => {
        if (part.type !== "incoming_attachment") return part;
        const { name, dataUrl } = part.upload as IncomingAttachment;
        if (includeImages && typeof dataUrl === "string" && /^data:image\//i.test(dataUrl)) {
            return { type: "image_url", image_url: { url: dataUrl } };
        }
        return { type: "text", text: `[attachment: ${attachmentName(name)}]` };
    });
}

function inlineAttachment(part: ContentPart): IncomingAttachment | undefined {
    if (part.type === ContentPartType.ImageUrl && /^data:image\//i.test(part.image_url?.url ?? "")) {
        return { name: "image", dataUrl: part.image_url.url };
    }
    if (part.type === ContentPartType.Image && typeof part.data === "string") {
        const mimeType = typeof part.mimeType === "string" && /^image\/[a-z\d.+-]+$/i.test(part.mimeType)
            ? part.mimeType
            : "image/png";
        return { name: "image", dataUrl: `data:${mimeType};base64,${part.data}` };
    }
    if (part.type === ContentPartType.Audio && typeof part.data === "string" &&
        typeof part.mimeType === "string" && /^audio\/[a-z\d.+-]+$/i.test(part.mimeType)) {
        return {
            name: "name" in part && typeof part.name === "string" ? part.name : "audio",
            dataUrl: `data:${part.mimeType};base64,${part.data}`,
            asAudio: true,
        };
    }
}

/** Called once after the message is routed to its effective saver. */
export async function saveMessageAttachments(content: MessageContent, directory: string): Promise<MessageContent> {
    if (typeof content === "string") return content;
    const parts: ContentPart[] = [];
    const written: string[] = [];
    try {
        for (const part of content) {
            const upload: IncomingAttachment | undefined = part.type === "incoming_attachment" ? part.upload : inlineAttachment(part);
            if (!upload) {
                parts.push(part);
                continue;
            }
            const name = attachmentName(upload.name);
            const data = typeof upload.dataUrl === "string"
                ? /^data:([\w.+-]+\/[\w.+-]+);base64,([a-z\d+/=\s]*)$/i.exec(upload.dataUrl)
                : null;
            const declaredMime = data?.[1].toLowerCase();
            const namedMime = detectMediaType(name).mimeType;
            const inferredMime = namedMime === "application/octet-stream" && upload.sourcePath
                ? detectMediaType(upload.sourcePath).mimeType
                : namedMime;
            const mimeType = declaredMime && declaredMime !== "application/octet-stream"
                ? declaredMime
                : inferredMime;
            const extension = path.extname(name).match(/^\.[a-z\d]{1,16}$/i)?.[0] ||
                (mimeType.startsWith("image/") ? `.${mimeType === "image/jpeg" ? "jpg" : mimeType.slice(6)}` : "");
            let bytes: Buffer;
            if (upload.sourcePath) bytes = await readFile(upload.sourcePath);
            else if (data) bytes = Buffer.from(data[2], "base64");
            else if (typeof upload.dataUrl !== "string" && typeof upload.content === "string") bytes = Buffer.from(upload.content);
            else throw new Error(`Unable to read attachment "${name}"`);

            if (!written.length) await mkdir(directory, { recursive: true });
            const filePath = path.resolve(directory, randomUUID() + extension);
            const file = await open(filePath, "wx", 0o600);
            written.push(filePath);
            try { await file.writeFile(bytes); }
            finally { await file.close(); }
            parts.push({ type: "attachment", name, filePath, mimeType, ...(upload.asAudio ? { asAudio: true } : {}) } satisfies SavedAttachment);
        }
        return parts;
    } catch (error) {
        await Promise.allSettled(written.map(filePath => unlink(filePath)));
        throw error;
    }
}

async function readAttachmentImage(part: SavedAttachment) {
    const original = await readFile(part.filePath);
    const bytes = await resizeImageIfNeeded(original);
    const mimeType = bytes === original ? part.mimeType : detectImageMimeType(bytes);
    return { mimeType, data: bytes.toString("base64") };
}

/** Use a model copy of the message, leaving the persisted references intact. */
export async function resolveMessageAttachments(content: MessageContent, includeImages = true): Promise<MessageContent> {
    if (typeof content === "string" || !content.some(isSavedAttachment)) return content;
    const parts = await Promise.all(content.map(async (part): Promise<ContentPart[]> => {
        if (!isSavedAttachment(part)) return [part];
        const label = `[attachment: ${JSON.stringify(part.name)}, filePath: ${JSON.stringify(part.filePath)}]`;
        const reference = { type: "text", text: label };
        if (part.asAudio && part.mimeType.startsWith("audio/")) {
            try {
                const bytes = await readFile(part.filePath);
                return [reference, { type: "audio", mimeType: part.mimeType, data: bytes.toString("base64") }];
            } catch {
                return [reference];
            }
        }
        if (!includeImages || !part.mimeType.startsWith("image/")) return [reference];
        try {
            const { mimeType, data } = await readAttachmentImage(part);
            return [reference, {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${data}` },
            }];
        } catch {
            return [{ type: "text", text: `${label} [image preview unavailable]` }];
        }
    }));
    return parts.flat();
}

export async function displayMessageAttachments(content: MessageContent): Promise<MessageContent> {
    if (typeof content === "string") return content;
    return Promise.all(content.map(async part => {
        if (!isSavedAttachment(part)) return part;
        try {
            if (part.mimeType.startsWith("image/")) {
                const { mimeType, data } = await readAttachmentImage(part);
                return { ...part, dataUrl: `data:${mimeType};base64,${data}` };
            }
            if (part.asAudio) {
                const bytes = await readFile(part.filePath);
                return { ...part, dataUrl: `data:${part.mimeType};base64,${bytes.toString("base64")}` };
            }
        } catch {
            // Keep the reference visible if the original file is unavailable.
        }
        return part;
    }));
}

/** Only a recorded image path in this saver is eligible for explicit history access. */
export async function readSavedAttachmentImage(saver: IAgentSaverService, filePath: string) {
    const messages = await saver.getAllMessages(true);
    for (const { message } of messages) {
        if (message.role !== MessageRole.Human || !Array.isArray(message.content)) continue;
        const part = message.content.find(part => isSavedAttachment(part) &&
            part.filePath === filePath && part.mimeType.startsWith("image/"));
        if (part && isSavedAttachment(part)) {
            const { mimeType, data } = await readAttachmentImage(part);
            return createImageContent(data, mimeType);
        }
    }
    throw new Error("This filePath is not an image attachment in the current conversation.");
}
