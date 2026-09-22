// 会话 run 状态查询（治「turn 被外部打断后界面永久转圈」）。
//
// 背景：后端重启 / 进程被杀会把一次 run 打死在图中的某个节点上（实测 01a09edd
// 停在 `next=['model']`，最后可见产物是 write_todos），此时既没有活跃 run 也不
// 会再有事件到达——前端只能看到流被掐断，isLoading 可能一直为 True，于是永久
// 停在最后一个工具调用上转圈。后端 `GET /api/threads/{tid}/run-status` 把
// 「图停在半轮且没人在推」显式暴露出来（四判据，宁可漏报不可误报），前端据此
// 渲染「上一轮回复已中断（未完成）」+「继续」按钮。
import { getConfig } from "@/lib/config";

/** 轮询间隔。中断事实不会自愈（没人推图），4s 只为覆盖重启抖动窗口。 */
export const TURN_STATUS_POLL_MS = 4000;

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

export interface ThreadRunStatus {
  ok: boolean;
  thread_id: string;
  checkpoint_id?: string | null;
  /** 有 pending/running 的 run（有人正在推图） */
  has_active_run: boolean;
  active_run_ids: string[];
  /** state.next：图停在哪些待执行节点 */
  next: string[];
  /** 图停在 HITL 审批上（界面另有审批卡，不算中断） */
  awaiting_interrupt: boolean;
  /** 最后一条消息是「终稿 assistant 文本」（打断时通常不是） */
  last_message_is_final: boolean;
  last_run: { run_id?: string; status?: string; updated_at?: string } | null;
  /** ← 渲染「已中断（可继续）」的唯一依据 */
  turn_incomplete: boolean;
  /**
   * ← 渲染「执行失败（可重试）」的唯一依据：最后一轮 run 是终态失败
   * （error / timeout）。与 turn_incomplete 互斥（后端已让位），否则新建会话第一轮
   * 被模型 400 打回时会显示成「被外部中断」，而「继续」只是把同一个必失败的请求
   * 再发一遍。
   */
  turn_failed: boolean;
  /** turn_failed 时的可读失败原因（后端从 state.tasks[].error 剥壳，可能为空串） */
  last_error?: string;
}

/**
 * 查询会话 run 状态。
 *
 * 失败时抛错（与 cancelTask 一致）；调用方对轮询失败**必须 fail-closed**：
 * 读不到就当作「没有中断信号」，绝不据此渲染横幅（后端同样 fail-closed，
 * 避免网络抖动弹出一条假「已中断」）。
 */
function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: "include" });
}

export async function fetchThreadRunStatus(
  threadId: string
): Promise<ThreadRunStatus> {
  const res = await authFetch(
    `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/run-status`,
    { method: "GET", headers: { Accept: "application/json" } }
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
  return data as unknown as ThreadRunStatus;
}
