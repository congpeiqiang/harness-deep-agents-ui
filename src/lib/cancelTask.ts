// 异步子任务取消 API 客户端（P1-8）。
// 用户在输入区进度卡片点「停止」时调用后端取消端点，
// 真正 cancel 子 run 并回写主线程 async_tasks.status=cancelled。
// 取消后无需前端手动刷新——轮询拾取 cancelled 态，卡片自动移入「已结束」。
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

export interface CancelTaskResult {
  ok: boolean;
  task_id: string;
  main_thread_id: string;
  status: string;
}

/**
 * 取消一个正在执行的异步子任务。
 * @param taskId 子任务线程 ID（async_tasks 的 task_id/thread_id）
 * @param mainThreadId 主会话 thread_id（后端据此回写 async_tasks）
 */
export async function cancelTask(
  taskId: string,
  mainThreadId: string
): Promise<CancelTaskResult> {
  const res = await fetch(
    `${apiBase()}/api/threads/${encodeURIComponent(taskId)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ main_thread_id: mainThreadId }),
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
  return data as unknown as CancelTaskResult;
}
