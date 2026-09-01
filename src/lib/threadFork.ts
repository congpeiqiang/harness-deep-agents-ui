// 会话分叉 API 客户端（P1-5，对标 deepseek-harness ui-workspace fork）。
// 后端编排 copy + 历史定位 + updateState 回退，返回新会话 ID；前端直接跳转。
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

export interface ForkResult {
  ok: boolean;
  /** 新（分叉出的）会话 ID */
  thread_id: string;
  source_thread_id: string;
  /** 回退到的 checkpoint；整线程复制时为 null */
  checkpoint_id: string | null;
  title?: string;
}

/**
 * 分叉会话。
 * @param threadId 源会话 ID
 * @param messageId 可选锚点消息：给定时新会话只保留截止到该消息的历史
 *                  （「从此处分叉」）；不给定时整线程复制。
 */
export async function forkThread(
  threadId: string,
  messageId?: string
): Promise<ForkResult> {
  const res = await fetch(
    `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/fork`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messageId ? { message_id: messageId } : {}),
    }
  );
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok || !data.ok) {
    const msg =
      typeof data.error === "string" && data.error
        ? data.error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as unknown as ForkResult;
}
