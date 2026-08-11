export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "completed" | "error" | "interrupted";
}

export interface SubAgent {
  id: string;
  name: string;
  subAgentName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: "pending" | "active" | "completed" | "error";
}

export interface FileItem {
  path: string;
  content: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "query";
  updatedAt?: Date;
}

/**
 * 并发查询任务（对应后端 async_tasks 中一个 task_id）。
 * 由 useChat 从 async_tasks × query_headers × subagent_steps_map 派生。
 */
export interface QueryTask {
  task_id: string;
  agent_name?: string;
  title: string; // 查询标题（去 📋 前缀）
  status: "running" | "success" | "error" | "cancelled" | "pending";
  created_at: string; // 用于最新置顶排序
  steps: TodoItem[]; // 该任务的子智能体步骤（查询阶段）
  chartStep?: TodoItem | null;   // 图表阶段（从主 todos content 匹配）
  reportStep?: TodoItem | null;  // 报告阶段（从主 todos content 匹配）
}
// TODO  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82WjJKSk1BPT06Y2M0MTg4M2Y=

export interface Thread {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}
// TODO  MS8yOmFIVnBZMlhrdUp2bG43bmx2TG82WjJKSk1BPT06Y2M0MTg4M2Y=

export interface InterruptData {
  value: any;
  ns?: string[];
  scope?: string;
}

export interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface ReviewConfig {
  actionName: string;
  allowedDecisions?: string[];
}

export interface ToolApprovalInterruptData {
  action_requests: ActionRequest[];
  review_configs?: ReviewConfig[];
}
