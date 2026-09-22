/**
 * 在线评估开关 API 客户端（设置 → 评估）
 *
 * 后端路由: src/api/eval_flags.py，覆盖层落盘 {AGENT_DATA_ROOT}/shared/eval_flags.json。
 * 写入即生效（评估器读时求值），无需重启后端；只覆盖传入的键，其余继续跟随 .env。
 */
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

// ── 类型 ─────────────────────────────────────────────────────

/** 取值来源：override=界面覆盖，env=.env/compose 注入，default=代码默认 */
export type EvalFlagSource = "override" | "env" | "default";

export interface EvalFlagItem {
  value: string;
  source: EvalFlagSource;
  default: string;
}

export type EvalFlagMap = Record<string, EvalFlagItem>;

export interface EvalFlagsResponse {
  ok: boolean;
  flags: EvalFlagMap;
  overrides: Record<string, string>;
  file?: string;
  error?: string;
}

export const EVAL_FLAG_KEYS = [
  "NL2SQL_EVAL_ENABLED",
  "NL2SQL_EVAL_JUDGE_ENABLED",
  "NL2SQL_EVAL_JUDGE_SAMPLE",
  "NL2SQL_EVAL_SUBJECT",
] as const;

export const EVAL_FLAG_LABELS: Record<string, string> = {
  NL2SQL_EVAL_ENABLED: "总开关",
  NL2SQL_EVAL_JUDGE_ENABLED: "LLM-judge 开关",
  NL2SQL_EVAL_JUDGE_SAMPLE: "LLM-judge 采样率",
  NL2SQL_EVAL_SUBJECT: "评估单元落盘",
};

// ── 请求 ─────────────────────────────────────────────────────

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

export function getEvalFlags(): Promise<EvalFlagsResponse> {
  return request<EvalFlagsResponse>("/api/eval-flags");
}

/** 增量改覆盖项：只传要改的键；值传空串 = 删除该键的覆盖（单独恢复默认）。 */
export function saveEvalFlags(
  flags: Record<string, string>
): Promise<EvalFlagsResponse> {
  return request<EvalFlagsResponse>("/api/eval-flags", {
    method: "PUT",
    body: JSON.stringify({ flags }),
  });
}

/** 清空全部覆盖项（所有开关回到 .env / 默认）。 */
export function resetEvalFlags(): Promise<EvalFlagsResponse> {
  return request<EvalFlagsResponse>("/api/eval-flags", { method: "DELETE" });
}

/** 布尔开关取值判定（与后端 eval_flags._OFF 一致）。 */
export function isFlagOn(item?: EvalFlagItem | null): boolean {
  if (!item) return false;
  return !["0", "false", "no", "off"].includes(item.value.trim().toLowerCase());
}
