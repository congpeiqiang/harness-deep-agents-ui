"use client";
// SQL 审批卡（P1-3）：子 agent 的 run_sql 被审批闸门 interrupt 后，
// sync 环路把 HITL payload 中继到主线程 async_tasks[task].awaiting_approval，
// C 方案轮询读到后由 ChatInterface 渲染本卡片（composer 上方）。
// 用户决策经 POST /api/threads/{sub}/sql-approval 恢复子 run。
//
// 协议注意：后端 HITLRequest 是 snake_case（action_requests/review_configs/
// action_name/allowed_decisions），而 ToolApprovalInterrupt 读 camelCase
// （actionName/allowedDecisions）——本组件负责转换。

import { ToolApprovalInterrupt } from "@/app/components/ToolApprovalInterrupt";
import type { ActionRequest, ReviewConfig } from "@/app/types/types";
import type { SqlApprovalDecision } from "@/lib/sqlApproval";

export interface SqlApprovalPayload {
  action_requests: Array<{
    name: string;
    args: Record<string, unknown>;
    description?: string;
  }>;
  review_configs?: Array<{
    action_name?: string;
    allowed_decisions?: string[];
  }>;
  interrupt_id?: string;
}

interface SqlApprovalCardProps {
  /** 子任务线程 ID（async_tasks 的 key / task_id） */
  taskId: string;
  /** 查询标题（可选，用于上下文提示） */
  title?: string;
  approval: SqlApprovalPayload;
  /** 决策提交中（禁用所有按钮） */
  busy?: boolean;
  /**
   * 提交单个决策；父组件负责把决策复制到所有 action_requests
   * （HITL 中间件要求 decisions 数量与被拦截调用数一致）。
   */
  onDecide: (
    taskId: string,
    decision: SqlApprovalDecision,
    actionCount: number
  ) => void;
}

export function SqlApprovalCard({
  taskId,
  title,
  approval,
  busy,
  onDecide,
}: SqlApprovalCardProps) {
  const actionRequests = Array.isArray(approval?.action_requests)
    ? approval.action_requests
    : [];
  if (actionRequests.length === 0) return null;

  // snake_case review_configs → camelCase ReviewConfig（按 action_name 匹配）
  const reviewConfigFor = (name: string): ReviewConfig | undefined => {
    const rc = (approval.review_configs || []).find(
      (r) => r?.action_name === name
    );
    if (!rc) return undefined;
    return {
      actionName: rc.action_name,
      allowedDecisions: rc.allowed_decisions,
    } as unknown as ReviewConfig;
  };

  return (
    <div className="mx-[18px] mb-3 space-y-2">
      <div className="text-xs text-muted-foreground">
        {title ? (
          <>
            任务 <span className="font-medium text-foreground">{title}</span>{" "}
            的 SQL 执行需要您批准，决定后自动继续。
          </>
        ) : (
          "SQL 执行需要您批准，决定后自动继续。"
        )}
      </div>
      {actionRequests.map((ar, idx) => (
        <ToolApprovalInterrupt
          key={`${taskId}-${ar.name}-${idx}`}
          actionRequest={ar as unknown as ActionRequest}
          reviewConfig={reviewConfigFor(ar.name)}
          isLoading={busy}
          onResume={(value: { decisions?: SqlApprovalDecision[] }) => {
            const decision = value?.decisions?.[0];
            if (decision) {
              onDecide(taskId, decision, actionRequests.length);
            }
          }}
        />
      ))}
    </div>
  );
}
