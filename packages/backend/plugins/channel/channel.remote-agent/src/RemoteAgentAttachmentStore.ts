import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { type AttachmentInput, writeAttachmentInput } from "channel.base";

/** Persists a non-image inline attachment received by the remote-agent protocol. */
export async function saveRemoteAgentAttachment(attachment: AttachmentInput): Promise<string> {
  const filePath = await createPath(attachment.name);
  await writeAttachmentInput(filePath, attachment);
  return filePath;
}

async function createPath(name: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sbot-remote-agent-"));
  return path.join(directory, `${randomUUID()}-${name}`);
}
