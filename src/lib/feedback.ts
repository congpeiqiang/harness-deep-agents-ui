// 消息反馈 API 客户端（P1-1，后端路由挂在 langgraph API 同端口 2026）
// 对标 deepseek-harness dsh-message-feedback：逐条消息 👍/👎 + 可选备注，version 做 CAS。
import { getConfig } from "@/lib/config";

export type FeedbackRating = "positive" | "negative";

export interface FeedbackRecord {
  thread_id: string;
  message_id: string;
  rating: FeedbackRating;
  note: string;
  version: number;
  created_at: string;
  updated_at: string;
  context?: Record<string, unknown>;
}

export interface FeedbackUpsertPayload {
  rating: FeedbackRating;
  note?: string;
  if_version?: number;
  context?: Record<string, unknown>;
}

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

const fbUrl = (threadId: string, messageId: string): string =>
  `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/feedback`;

/** 新建/更新反馈，返回服务端记录（含最新 version）。409 → throw（CAS 冲突）。 */
export async function putFeedback(
  threadId: string,
  messageId: string,
  payload: FeedbackUpsertPayload
): Promise<FeedbackRecord> {
  const res = await fetch(fbUrl(threadId, messageId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await handle<{ ok: boolean; feedback: FeedbackRecord }>(res);
  return j.feedback;
}

/** 撤销反馈。不存在 → throw（404）。 */
export async function deleteFeedback(
  threadId: string,
  messageId: string,
  ifVersion?: number
): Promise<void> {
  const res = await fetch(fbUrl(threadId, messageId), {
    method: "DELETE",
    headers: ifVersion != null ? { "Content-Type": "application/json" } : undefined,
    body: ifVersion != null ? JSON.stringify({ if_version: ifVersion }) : undefined,
  });
  await handle<{ ok: boolean }>(res);
}

/** 会话内全部反馈（打开会话时回显图标态），key 由调用方按 message_id 聚合。 */
export async function listThreadFeedback(
  threadId: string
): Promise<FeedbackRecord[]> {
  const res = await fetch(
    `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/feedback`,
    { cache: "no-store" }
  );
  const j = await handle<{ feedback: FeedbackRecord[] }>(res);
  return j.feedback || [];
}
