import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

// ── Singleton R2 client ──
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET!;

// ── Types ──
export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationData extends ConversationMeta {
  messages: unknown[]; // UIMessage[] serialized
  executedMutations?: [string, { auditLogId: string; toolName: string; undone?: boolean }][];
}

// ── Helpers ──
function indexKey(userId: string) {
  return `conversations/${userId}/index.json`;
}

function conversationKey(userId: string, convId: string) {
  return `conversations/${userId}/${convId}.json`;
}

// ── Index Operations ──
export async function getIndex(userId: string): Promise<ConversationMeta[]> {
  try {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: indexKey(userId) })
    );
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return [];
    }
    throw err;
  }
}

export async function putIndex(userId: string, entries: ConversationMeta[]) {
  // Sort by updatedAt descending so newest is first
  entries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: indexKey(userId),
      Body: JSON.stringify(entries),
      ContentType: "application/json",
    })
  );
}

// ── Conversation CRUD ──
export async function putConversation(userId: string, data: ConversationData) {
  // 1. Save the full conversation
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: conversationKey(userId, data.id),
      Body: JSON.stringify(data),
      ContentType: "application/json",
    })
  );

  // 2. Update the index
  const index = await getIndex(userId);
  const meta: ConversationMeta = {
    id: data.id,
    title: data.title,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    messageCount: data.messageCount,
  };
  const existing = index.findIndex((e) => e.id === data.id);
  if (existing >= 0) {
    index[existing] = meta;
  } else {
    index.push(meta);
  }
  await putIndex(userId, index);
}

export async function getConversation(userId: string, convId: string): Promise<ConversationData | null> {
  try {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: conversationKey(userId, convId) })
    );
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function deleteConversation(userId: string, convId: string) {
  // 1. Delete the file
  await r2.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: conversationKey(userId, convId) })
  );

  // 2. Update the index
  const index = await getIndex(userId);
  const filtered = index.filter((e) => e.id !== convId);
  await putIndex(userId, filtered);
}

/**
 * Delete ALL R2 objects for a user (conversations + index).
 * Used during account deletion to prevent orphaned storage.
 */
export async function deleteR2Folder(userId: string) {
  const prefix = `conversations/${userId}/`;

  // List all objects under the user's prefix
  const listRes = await r2.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
  );

  if (!listRes.Contents || listRes.Contents.length === 0) return;

  // Delete each object
  for (const obj of listRes.Contents) {
    if (obj.Key) {
      await r2.send(
        new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key })
      );
    }
  }
}
