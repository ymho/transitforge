import { randomUUID } from "node:crypto";

import { type JsonObject, RequestError } from "../contracts/agent-request.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { PrivateObjectStorage } from "../ports/private-object-storage.js";

const maximumMessages = 50;
const maximumTextCharacters = 4_000;
const maximumRequestIds = 50;
const maximumCommentCharacters = 1_000;
const maximumStoredBytes = 256 * 1_024;

export interface FeedbackOperationOptions {
  bucket: string;
  storage: PrivateObjectStorage;
  now?: () => Date;
  createId?: () => string;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export function createConversationFeedbackOperation(
  options: FeedbackOperationOptions,
): AgentOperation {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const log = options.log ?? (() => undefined);
  return async (request, context) => {
    const startedAt = performance.now();
    try {
      const result = await storeConversationFeedback(request, options, now(), createId());
      log("conversation_feedback_stored", {
        requestId: context.requestId,
        feedbackId: result.feedbackId,
        rating: request.rating,
        schemaVersion: request.schemaVersion ?? "conversation-feedback-v1",
        sessionId: request.sessionId,
        targetMessageId: request.targetMessageId,
        messageCount: Array.isArray(request.conversation) ? request.conversation.length : 0,
        relatedRequestCount: Array.isArray(request.requestIds) ? request.requestIds.length : 0,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { body: result };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      log("conversation_feedback_store_failed", {
        requestId: context.requestId,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return {
        statusCode: 503,
        body: { message: "会話フィードバックを保存できませんでした。" },
      };
    }
  };
}

export async function storeConversationFeedback(
  value: JsonObject,
  options: Pick<FeedbackOperationOptions, "bucket" | "storage">,
  now: Date,
  feedbackId: string,
): Promise<{ feedbackId: string }> {
  if (!options.bucket) throw new RequestError(503, "フィードバック保存先を利用できません。");
  const schemaVersion = value.schemaVersion ?? "conversation-feedback-v1";
  const fields = schemaVersion === "conversation-feedback-v1"
    ? validatedV1(value)
    : schemaVersion === "conversation-feedback-v2"
      ? validatedV2(value)
      : (() => { throw new RequestError(400, "フィードバックのバージョンが不正です。"); })();
  const payload = {
    schemaVersion,
    feedbackId,
    createdAt: isoTimestamp(now),
    ...fields,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  if (encoded.byteLength > maximumStoredBytes) {
    throw new RequestError(413, "フィードバックの保存容量を超えています。");
  }
  await options.storage.put({
    bucket: options.bucket,
    key: `conversation-feedback/${datePath(now)}/${feedbackId}.json`,
    body: encoded,
    contentType: "application/json",
    encryption: "AES256",
  });
  return { feedbackId };
}

function validatedV1(value: JsonObject): JsonObject {
  return {
    rating: validatedRating(value),
    requestIds: validatedRequestIds(value.requestIds ?? []),
    conversation: validatedMessages(value.conversation, false),
  };
}

function validatedV2(value: JsonObject): JsonObject {
  const rating = validatedRating(value);
  const sessionId = validatedIdentifier(value.sessionId, "会話ID");
  const targetMessageId = validatedIdentifier(value.targetMessageId, "対象メッセージID");
  const requestIds = validatedRequestIds(value.requestIds ?? []);
  const conversation = validatedMessages(value.conversation, true);
  const target = conversation.at(-1);
  if (target?.messageId !== targetMessageId || target.role !== "assistant") {
    throw new RequestError(400, "評価対象の回答が会話末尾にありません。");
  }
  const linkedIds = conversation.flatMap((message) =>
    typeof message.requestId === "string" ? [message.requestId] : []
  );
  if (linkedIds.some((id) => !requestIds.includes(id))) {
    throw new RequestError(400, "リクエストIDと会話の対応が不正です。");
  }
  let comment: string | undefined;
  if (value.comment !== undefined) {
    if (rating !== "bad" || typeof value.comment !== "string") {
      throw new RequestError(400, "コメントの形式が不正です。");
    }
    comment = value.comment.trim();
    if (!comment || comment.length > maximumCommentCharacters || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(comment)) {
      throw new RequestError(400, "コメントの文字数または文字種が不正です。");
    }
  }
  return {
    rating,
    ...(comment === undefined ? {} : { comment }),
    sessionId,
    targetMessageId,
    requestIds,
    conversation,
  };
}

function validatedRating(value: JsonObject): "good" | "bad" {
  if (value.rating !== "good" && value.rating !== "bad") {
    throw new RequestError(400, "フィードバックの形式が不正です。");
  }
  return value.rating;
}

function validatedRequestIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > maximumRequestIds ||
    !value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 128)) {
    throw new RequestError(400, "リクエストIDの形式が不正です。");
  }
  return value;
}

function validatedMessages(value: unknown, requireIds: boolean): JsonObject[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumMessages) {
    throw new RequestError(400, "フィードバックの形式が不正です。");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant") || typeof item.text !== "string") {
      throw new RequestError(400, "会話の形式が不正です。");
    }
    const text = item.text.trim();
    if (!text || text.length > maximumTextCharacters) {
      throw new RequestError(400, "会話の文字数が不正です。");
    }
    if (!requireIds) return { role: item.role, text };
    const messageId = validatedIdentifier(item.messageId, "メッセージID");
    if (seen.has(messageId)) throw new RequestError(400, "メッセージIDが重複しています。");
    seen.add(messageId);
    return {
      messageId,
      role: item.role,
      text,
      ...(item.requestId === undefined ? {} : {
        requestId: validatedIdentifier(item.requestId, "リクエストID", 128),
      }),
    };
  });
}

function validatedIdentifier(value: unknown, label: string, limit = 100): string {
  if (typeof value !== "string" || value.length < 1 || value.length > limit) {
    throw new RequestError(400, `${label}の形式が不正です。`);
  }
  return value;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function datePath(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "/");
}

function isoTimestamp(value: Date): string {
  return value.toISOString().replace(".000Z", "+00:00");
}
