// SQL 审批决策 API 客户端（P1-3，对标 deepseek-harness ApprovalPanel）。
// 子 agent 的 run_sql 被审批闸门 interrupt 后，前端审批卡的用户决策
// （approve/edit/reject）经后端恢复端点回传，子 run 从断点继续。
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

/** 与后端 HumanInTheLoopMiddleware 的 Decision 协议一致（snake_case）。 */
export type SqlApprovalDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | {
      type: "edit";
      edited_action: { name: string; args: Record<string, unknown> };
    };

export interface SqlApprovalResult {
  ok: boolean;
  thread_id: string;
  main_thread_id: string;
  run_id?: string | null;
}

/**
 * 提交 SQL 审批决策，恢复被 interrupt 的子任务 run。
 * @param subThreadId 子任务线程 ID（async_tasks 的 task_id/thread_id）
 * @param body main_thread_id=主会话 ID；decisions=决策列表（与 action_requests 等长）
 */
export async function decideSqlApproval(
  subThreadId: string,
  body: {
    main_thread_id: string;
    decisions: SqlApprovalDecision[];
    db_name?: string;
  }
): Promise<SqlApprovalResult> {
  const res = await fetch(
    `${apiBase()}/api/threads/${encodeURIComponent(subThreadId)}/sql-approval`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  return data as unknown as SqlApprovalResult;
}
