/**
 * 定时任务管理 API 客户端（后端 src/api/scheduled_tasks.py，方案 §5/§6）。
 *
 * 契约：成功 `{"ok":true, task/tasks/runs}`；失败 `{"ok":false, error}`（400/404/401）
 * —— 统一抛 `Error(.error)`，调用方拿到的就是可直接展示给用户的消息。
 *
 * 地址解析：`getConfig().deploymentUrl` 已在 lib/config.ts 强制解析（空 = 跟随入口
 * origin）。⚠️ 不要模仿旧代码 `|| "http://localhost:2026"` 兜底 —— deploymentUrl.ts
 * 的头注释明说那是死代码，新代码写它就等于绕过唯一强制点。
 */
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  return (cfg?.deploymentUrl || "").replace(/\/+$/, "");
};

// ── 类型（与后端 store.py 行结构对齐）────────────────────────

export type TaskState = "scheduled" | "paused" | "completed" | "error";

export interface ScheduledTask {
  id: string;
  owner: string;
  name: string;
  prompt: string;
  db_name: string;
  llm_route: string;
  llm_model: string;
  sched_kind: "cron" | "interval" | "once";
  sched_expr: string;
  sched_display: string;
  tz: string;
  /** UTC ISO；completed 后为空串 */
  next_run_at: string;
  enabled: number;
  state: TaskState;
  repeat_times: number | null;
  repeat_completed: number;
  /** 非空 = 在飞（占位 "-" 或真实 thread_id） */
  running_thread_id: string;
  last_run_at: string;
  last_status: string;
  last_error: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRun {
  id: string;
  task_id: string;
  thread_id: string;
  run_id: string;
  fired_at: string;
  finished_at: string;
  status: string;
  error: string;
}

export interface TaskPayload {
  name: string;
  prompt: string;
  db_name: string;
  sched_kind: "cron" | "interval" | "once";
  sched_expr: string;
  tz?: string;
  repeat_times?: number | null;
}

export interface PreviewResult {
  ok: boolean;
  runs: string[];
  sched_display: string;
}

// ── 请求（evalFlags.ts request<T> 同款）──────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "include",
    ...init,
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const msg =
      typeof data.error === "string" && data.error
        ? data.error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export function listScheduledTasks(
  showAll = false
): Promise<{ ok: boolean; tasks: ScheduledTask[] }> {
  return request(`/api/scheduled-tasks${showAll ? "?all=1" : ""}`);
}

export function createScheduledTask(
  payload: TaskPayload
): Promise<{ ok: boolean; task: ScheduledTask }> {
  return request("/api/scheduled-tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 字段级修改（name/prompt/db_name/sched_kind/sched_expr/tz/repeat_times）。 */
export function updateScheduledTask(
  id: string,
  patch: Partial<TaskPayload>
): Promise<{ ok: boolean; task: ScheduledTask }> {
  return request(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function pauseScheduledTask(
  id: string
): Promise<{ ok: boolean; task: ScheduledTask }> {
  return request(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "pause" }),
  });
}

export function resumeScheduledTask(
  id: string
): Promise<{ ok: boolean; task: ScheduledTask }> {
  return request(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "resume" }),
  });
}

export function deleteScheduledTask(
  id: string
): Promise<{ ok: boolean }> {
  return request(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** 立即运行一次（与 tick 同一个 CAS 认领，双路互斥）。 */
export function runScheduledTaskNow(
  id: string
): Promise<{ ok: boolean; task: ScheduledTask }> {
  return request(
    `/api/scheduled-tasks/${encodeURIComponent(id)}/run`,
    { method: "POST" }
  );
}

export function listScheduledRuns(
  id: string,
  limit = 20
): Promise<{ ok: boolean; runs: TaskRun[] }> {
  return request(
    `/api/scheduled-tasks/${encodeURIComponent(id)}/runs?limit=${limit}`
  );
}

/** 创建表单实时预览：未来 count 次触发时间（UTC ISO）+ 人类可读描述。 */
export function previewSchedule(
  sched_kind: TaskPayload["sched_kind"],
  sched_expr: string,
  tz?: string,
  count = 3
): Promise<PreviewResult> {
  return request("/api/scheduled-tasks/preview", {
    method: "POST",
    body: JSON.stringify({ sched_kind, sched_expr, tz, count }),
  });
}
