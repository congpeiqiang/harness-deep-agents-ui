// 会话全文搜索 API 客户端（P1-6，对标 deepseek-harness dsh-session-query）。
// 后端 GET /api/threads/fts?q= 用 SQLite FTS5（trigram 分词支持中文子串）
// 检索历史会话的问答与 SQL，短词（≤2 字）自动回退 LIKE 子串扫描。
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

export interface ThreadSearchResult {
  thread_id: string;
  title: string;
  updated_at: string;
  snippet: string;
  matched_count: number;
}

/**
 * 按关键词检索历史会话，返回命中列表（title + 命中上下文片段）。
 * @param q 检索关键词（≥1 字；≤2 字走 LIKE 子串，≥3 字走 FTS5 trigram）
 */
export async function searchThreads(
  q: string,
  limit = 20
): Promise<ThreadSearchResult[]> {
  const url = `${apiBase()}/api/threads/fts?q=${encodeURIComponent(
    q
  )}&limit=${limit}`;
  const res = await fetch(url);
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
  return (data.results as ThreadSearchResult[]) ?? [];
}
