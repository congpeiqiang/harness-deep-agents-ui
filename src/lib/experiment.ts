// 离线 AB Test API 客户端。
// 对应后端 src/api/experiment.py（离线实验：数据集 × prompt 版本 × skill 版本 × 语义库版本）。
// 与 /experiment 页（离线测试）配套。
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { "Content-Type": "application/json" },
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

// ── 元数据枚举 ──────────────────────────────────────────

export interface DatasetMeta {
  name: string;
  count: number;
  error?: string;
}

export interface PromptInfo {
  name: string;
  labels: string[];
  versions?: number;
  found?: number;
  error?: string;
}

export interface GitRefs {
  tags: string[];
  branches: string[];
  head: string;
  /** 后端提示（如 skill 目录未提交 git 时说明暂无可用版本） */
  note?: string;
}

// ── arm / 请求 / 结果 ──────────────────────────────────

export interface ArmDef {
  name: string;
  /** Langfuse prompt label；空 = production 默认 */
  prompt_label?: string;
  /** skill 版本 git ref；空 = 当前磁盘 skill */
  skill_ref?: string;
  /** 语义库版本 git ref；空 = 当前 HEAD */
  semantic_ref?: string;
}

export interface RunRequest {
  datasets: string[];
  dataset_limit?: number;
  arms: ArmDef[];
  judge?: boolean;
  threshold?: number;
  /** 实验级描述（整轮一条；Langfuse run 描述 + run 记录共用，可选） */
  description?: string;
}

export interface ExperimentRecord {
  label: string;
  index: number;
  question: string;
  db_name?: string;
  run_id?: string;
  sql?: string;
  result_head?: string;
  scores: Record<string, number | null | undefined>;
  reasons?: string[];
  strategy?: string;
  trace_id?: string;
  dataset_item_id?: string;
  dataset_name?: string;
  semantic?: string;
  skill_ref?: string;
  run_name?: string;
  trace_url?: string;
}

export interface GateResult {
  passed: boolean;
  failures: string[];
  ref: string;
  cand: string;
  threshold: number;
}

export type RunStatus =
  | "running"
  | "cancelling"
  | "done"
  | "error"
  | "interrupted"
  | "cancelled";

export interface RunProgress {
  stage: string;
  total: number;
  done: number;
  current: string;
}

export interface RunSummary {
  stamp: string;
  status: RunStatus;
  stage: string;
  dataset: string;
  arms: ArmDef[];
  gate: GateResult | null;
  started_at: string;
  finished_at: string;
  /** 实验级描述（提交时填写，可选） */
  description?: string;
}

export interface RunDetail {
  stamp: string;
  status: RunStatus;
  stage: string;
  arms: ArmDef[];
  progress: RunProgress | null;
  error: string;
  started_at: string;
  finished_at: string;
  /** 实验级描述（提交时填写，可选） */
  description?: string;
  manifest: Record<string, unknown> | null;
  items: Record<string, ExperimentRecord[]>;
  gate: GateResult | null;
}

// ── 打分维度元数据（离线评估 4 维，仅展示用） ─────────────
// 后端 item.scores 是动态 dict（judge 关时可能缺 biz_correct）。
// 前端按固定顺序渲染，缺失维度显示 —。
export const SCORE_DIMS: { key: string; label: string; short: string }[] = [
  { key: "sql_biz_correct_score", label: "业务正确", short: "Biz" },
  { key: "sql_valid_score", label: "SQL 有效", short: "Valid" },
  { key: "sql_exec_success", label: "执行成功", short: "Exec" },
  { key: "schema_match_score", label: "Schema 匹配", short: "Schema" },
];

export function dimValue(rec: ExperimentRecord, key: string): number | null {
  const v = rec.scores?.[key];
  return typeof v === "number" ? v : null;
}

// ── API ────────────────────────────────────────────────

export interface DatasetList {
  datasets: DatasetMeta[];
  /** 后端区分「暂无数据集」与「读取失败」的原因文案 */
  note?: string;
}

export async function fetchDatasets(): Promise<DatasetList> {
  const resp = await request<{ datasets: DatasetMeta[]; note?: string }>(
    "/api/experiment/datasets"
  );
  return { datasets: resp.datasets ?? [], note: resp.note };
}

export async function fetchPromptLabels(name?: string): Promise<PromptInfo[]> {
  const q = name ? `?name=${encodeURIComponent(name)}` : "";
  const resp = await request<{ prompts: PromptInfo[] }>(
    `/api/experiment/prompt-labels${q}`
  );
  return resp.prompts ?? [];
}

export async function fetchSkillRefs(): Promise<GitRefs> {
  return request<GitRefs>("/api/experiment/skill-refs");
}

export async function fetchSemanticRefs(db: string): Promise<GitRefs> {
  return request<GitRefs>(
    `/api/experiment/semantic-refs?db=${encodeURIComponent(db)}`
  );
}

export async function submitRun(req: RunRequest): Promise<{
  ok: boolean;
  stamp: string;
  status_url: string;
}> {
  return request("/api/experiment/runs", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function listRuns(): Promise<RunSummary[]> {
  const resp = await request<{ runs: RunSummary[] }>("/api/experiment/runs");
  return resp.runs ?? [];
}

export async function fetchRun(stamp: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/experiment/runs/${stamp}`);
}

export async function deleteRun(stamp: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/experiment/runs/${stamp}`, {
    method: "DELETE",
  });
}

/** 停止运行中的实验：后端写停止标记，orchestrator/worker 在每题/每臂断点干净退出，
 * run 状态经 cancelling（暂态）→ cancelled（终态，保留已完成部分）。 */
export async function cancelRun(stamp: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/experiment/runs/${stamp}/cancel`, {
    method: "POST",
  });
}
