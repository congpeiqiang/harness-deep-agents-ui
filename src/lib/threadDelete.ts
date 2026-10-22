// 删会话 API 客户端（2026-10-22）。
//
// 为什么不用 SDK 的 `client.threads.delete()`：langgraph 的 DELETE /threads/{id}
// **只删注册表行，不 cancel 任何 run** —— 删掉一个正在跑的会话，它的 run 会继续
// 跑（还可能继续派子任务，占着后端全局 10 个 run 槽）。后端自定义端点
// DELETE /api/threads/{id} 负责「先取消这次在飞的 run（主 + 子），再删会话」，
// 且不影响下一次定时触发（语义见 src/api/thread_delete.py）。
import { getConfig } from "@/lib/config";
import { resolveDeploymentUrl } from "@/lib/deploymentUrl";

const apiBase = (): string => resolveDeploymentUrl(getConfig()?.deploymentUrl);

export async function deleteThread(threadId: string): Promise<void> {
  const res = await fetch(
    `${apiBase()}/api/threads/${encodeURIComponent(threadId)}`,
    { method: "DELETE" }
  );
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok || data.ok === false) {
    const msg =
      typeof data.error === "string" && data.error
        ? data.error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
}
