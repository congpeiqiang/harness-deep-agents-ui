// 反馈闭环 API 客户端（待标注队列）。
// 对应后端 src/api/feedback_annotation.py。
// 与 /feedback/annotate 页（标注）配套。
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

// ── 标注队列 ──────────────────────────────────────────

export type AnnotationStatus =
  | "queued"
  | "annotating"
  | "validated"
  | "rejected"
  | "badcase"
  | "good";

export interface Annotation {
  thread_id: string;
  message_id: string;
  feedback_type: string;
  question: string;
  bad_sql: string;
  exec_error: string;
  note: string;
  rating: string;
  db_name: string;
  status: AnnotationStatus;
  is_valid: number | null;
  gold_sql: string;
  gold_result: string;
  bad_type: string;
  annotator: string;
  created_at: string;
  annotated_at: string;
  badcase_at: string;
}

export interface BadType {
  key: string;
  label: string;
  desc: string;
}

export interface ExecResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  [k: string]: unknown;
}

export interface AnnotationListResponse {
  count: number;
  annotations: Annotation[];
}

export async function fetchAnnotations(
  status: string,
  limit = 50
): Promise<AnnotationListResponse> {
  const q = status
    ? `?status=${encodeURIComponent(status)}&limit=${limit}`
    : `?limit=${limit}`;
  return request<AnnotationListResponse>(`/api/feedback/annotations${q}`);
}

// ── Langfuse Dataset 直读（BadCase / Good Set 模块，与 Langfuse UI Dataset 一致）──

export type DatasetSource = "auto-collect" | "user-annotation" | string;

export interface DatasetItem {
  item_id: string;
  question: string;
  session_id: string;
  sql: string;
  source: DatasetSource; // auto-collect / user-annotation
  db_name: string;
  trace_id: string;
  bad_type: string;
  rating: string;
  reasons: string[];
  created_at: string;
  collected_at: string;
}

export interface DatasetListResponse {
  dataset: string;
  count: number;
  items: DatasetItem[];
}

export async function fetchDatasetItems(
  name: "badcase" | "goodcase",
  limit = 200
): Promise<DatasetListResponse> {
  return request<DatasetListResponse>(
    `/api/feedback/datasets?name=${encodeURIComponent(name)}&limit=${limit}`
  );
}

export const SOURCE_LABEL: Record<string, string> = {
  "auto-collect": "自动采集",
  "user-annotation": "人工确认",
};

export async function fetchAnnotation(
  threadId: string,
  messageId: string
): Promise<{ annotation: Annotation }> {
  return request<{ annotation: Annotation }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}`
  );
}

export async function fetchBadTypes(): Promise<BadType[]> {
  const data = await request<{ bad_types: BadType[] }>(
    "/api/feedback/annotations/bad-types"
  );
  return data.bad_types ?? [];
}

export async function judgeAnnotation(
  threadId: string,
  messageId: string,
  isValid: boolean,
  annotator: string,
  directGood = false
): Promise<{ ok: boolean; annotation: Annotation }> {
  const data = await request<{ ok: boolean; annotation: Annotation }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/judge`,
    {
      method: "POST",
      body: JSON.stringify({
        is_valid: isValid,
        annotator,
        direct_good: directGood,
      }),
    }
  );
  if (!data.ok) throw new Error("judge 失败");
  return data;
}

export async function executeAnnotation(
  threadId: string,
  messageId: string,
  sql: string,
  dbName: string
): Promise<{ ok: boolean; result: ExecResult }> {
  const data = await request<{ ok: boolean; result: ExecResult }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/execute`,
    {
      method: "POST",
      body: JSON.stringify({ sql, db_name: dbName }),
    }
  );
  if (!data.ok) throw new Error("执行失败");
  return data;
}

export async function confirmAnnotation(
  threadId: string,
  messageId: string,
  payload: {
    gold_sql: string;
    bad_type: string;
    note?: string;
    db_name?: string;
    annotator?: string;
  }
): Promise<{ ok: boolean; annotation: Annotation }> {
  const data = await request<{ ok: boolean; annotation: Annotation }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  if (!data.ok) throw new Error("确认失败");
  return data;
}

export async function confirmGoodAnnotation(
  threadId: string,
  messageId: string,
  payload: {
    sql?: string;
    db_name?: string;
    annotator?: string;
  }
): Promise<{ ok: boolean; annotation: Annotation }> {
  const data = await request<{ ok: boolean; annotation: Annotation }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/confirm-good`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  if (!data.ok) throw new Error("确认失败");
  return data;
}
