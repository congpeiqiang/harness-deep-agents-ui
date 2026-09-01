// 会话元数据助手（P1-4 会话重命名 + 自动标题）。
// 标题持久化在 thread metadata.title：先 get 现有 metadata 再合并写回，
// 避免 threads.update 整体覆盖导致 graph_id/assistant_id 等过滤字段丢失。
import type { Client } from "@langchain/langgraph-sdk";
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

/** 把标题写入 thread metadata.title（保留其余 metadata 字段）。 */
export async function setThreadTitle(
  client: Client,
  threadId: string,
  title: string
): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const t = await client.threads.get(threadId);
    existing = (t?.metadata as Record<string, unknown>) || {};
  } catch {
    existing = {};
  }
  await client.threads.update(threadId, {
    metadata: { ...existing, title },
  });
}

/** 调后端 /api/auto-title 用 LLM 生成短标题；失败返回 null（调用方自行兜底）。 */
export async function generateAutoTitle(text: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/api/auto-title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.title === "string" && j.title.trim() ? j.title.trim() : null;
  } catch {
    return null;
  }
}
