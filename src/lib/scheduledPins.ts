"use client";
// 定时任务「固化查询」前端封装。
//
// 背景：定时任务每次触发现场让模型重写 SQL，同一句话两次跑出的口径可能不同。
// 固化 = 把**跑对过的那一次**存成「模板 + 日期锚点」，之后每次触发按当天日期
// 渲染后直接执行，不再经过模型。
//
// 后端：GET / POST / DELETE `/api/scheduled-tasks/{id}/pin`
//   - POST   固化（可带 thread_id 指定来源流水、date_bindings 消歧）
//   - DELETE 取消固化（下次触发回到正常 agent 执行）
//   - GET    当前固化状态 + spec（未固化时 `pin: null`）
//
// 为什么不复用 `lib/scheduledTasks.ts`：那个文件的 `ScheduledTask` 类型里没有
// pin 字段，且该文件由构建流水线维护，不经本改动。这里用本地结构化类型，
// 自带一个最小的 `request`（与它同款：带 cookie、失败取 `data.error`）。

import { getConfig } from "@/lib/config";
import { resolveDeploymentUrl } from "@/lib/deploymentUrl";

/** 固化成功时后端回传的预览（渲染后的 SQL 与参数取值）。 */
export type ScheduledPin = {
  /** sql = 直连库的物理 SQL；cube = 语义层编译后的 SQL */
  channel: "sql" | "cube" | string;
  /** 按**固化当天**日期渲染后的完整 SQL —— 弹层里要给用户看这个 */
  preview_sql: string;
  /** 锚点 → 实际取值（如 `{ month_start: "2026-10-01" }`） */
  params: Record<string, string>;
  /** 固化时发现的、需要用户知情的情况（截断、常量日期被接受等） */
  warnings: string[];
};

/** `GET .../pin` 的返回（固化详情，含 spec 原文）。 */
export type ScheduledPinDetail = {
  status: "" | "active" | "invalid";
  semantic_version: string;
  saved_at: string;
  invalid_reason: string;
  source_thread_id: string;
  spec: Record<string, unknown>;
};

/**
 * 任务行里本模块关心的字段。**不从** `scheduledTasks.ts` 引 `ScheduledTask`：
 * 那个类型没有 pin 字段（后端已加，前端类型未跟上），用结构化类型局部收窄。
 */
export type ScheduledTaskLike = {
  id: string;
  name?: string;
  pin_status?: "" | "active" | "invalid";
  pin_invalid_reason?: string;
  /**
   * 固化来源那一轮 run 的 thread_id（后端 `pin_source_thread_id`）。
   * 运行历史里用它给「就是这条被固化了」的行打标记——否则用户从某条历史
   * 点过「用这次固化」之后，界面上没有任何地方还能认出是哪一条。
   */
  pin_source_thread_id?: string;
};

export type PinOptions = {
  /** 指定来源流水（缺省 = 该任务最近一次成功 run 的 thread） */
  thread_id?: string;
  /** 允许把写死的日期当作常量固化（默认拒绝，避免固化一次就永远查同一天） */
  accept_constants?: boolean;
  /**
   * 同一日期匹配多个锚点时的消歧：**日期字面量 → 锚点名**
   * （如 `{ "2026-10-26": "yesterday" }`）。用户点选的正是这个映射。
   */
  date_bindings?: Record<string, string>;
};

/**
 * 固化失败。`code` 是后端的失效码（`unmatched_date` / `ambiguous_date` / …），
 * 调用方据此决定给不给下一步动作——`message` 只用来给人看。
 */
export class ScheduledPinError extends Error {
  code: string;
  /**
   * 机读补充数据（目前只有 `ambiguous_date` 的 `literal` + `candidates`）。
   * 文案（`message`）只给人看，程序判断一律走 `code` / `extra`。
   */
  extra: PinErrorExtra;

  constructor(message: string, code = "", extra: PinErrorExtra = {}) {
    super(message);
    this.name = "ScheduledPinError";
    this.code = code;
    this.extra = extra;
  }
}

export type PinErrorExtra = {
  /** 撞了多个锚点的那个日期字面量（YYYY-MM-DD） */
  literal?: string;
  /** 候选锚点名（占位符名，如 yesterday / week_start） */
  candidates?: string[];
};

/**
 * 锚点 → 中文标签。同一天可能既是「昨天」又是「本周开始」（周二），也可能既是
 * 「今天」又是「本月 1 号」（每月 1 号）——日期字面量分不出来，选择框必须说人话。
 */
export const PIN_ANCHOR_LABELS: Record<string, string> = {
  today: "今天",
  yesterday: "昨天",
  tomorrow: "明天",
  week_start: "本周开始（周一）",
  month_start: "本月 1 号",
  last_month_start: "上月 1 号",
  last_month_end: "上月末",
  year_start: "今年 1 月 1 号",
};

export const pinAnchorLabel = (anchor: string): string =>
  PIN_ANCHOR_LABELS[anchor] || anchor;

const apiBase = (): string => {
  const cfg = getConfig();
  // 留空 = window.location.origin（与 lib/deploymentUrl.ts 同口径）
  return resolveDeploymentUrl(cfg?.deploymentUrl);
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON（网关 502 之类）⇒ 保持 null，下面按状态码报错
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error || `HTTP ${res.status}`;
    const err = data as
      | { code?: string; extra?: PinErrorExtra }
      | null;
    throw new ScheduledPinError(msg, err?.code || "", err?.extra || {});
  }
  return data as T;
}

/** 读当前固化状态；未固化返回 `null`（不是 404）。 */
export async function getScheduledPin(
  id: string
): Promise<ScheduledPinDetail | null> {
  const out = await request<{ pin: ScheduledPinDetail | null }>(
    `/api/scheduled-tasks/${encodeURIComponent(id)}/pin`
  );
  return out?.pin ?? null;
}

/**
 * 固化：后端会**真跑一次查询**验证，返回渲染后的 SQL 供用户确认。
 * 失败（日期歧义、列漂移、语义库编译失败…）抛 `Error`，message 已是中文提示。
 */
export async function pinScheduledTask(
  id: string,
  opts: PinOptions = {}
): Promise<{ ok: true; task: ScheduledTaskLike; pin: ScheduledPin }> {
  return request<{
    ok: true;
    task: ScheduledTaskLike;
    pin: ScheduledPin;
  }>(`/api/scheduled-tasks/${encodeURIComponent(id)}/pin`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

/** 取消固化：任务回到正常 agent 执行。 */
export async function unpinScheduledTask(
  id: string
): Promise<{ ok: true; task: ScheduledTaskLike }> {
  return request<{ ok: true; task: ScheduledTaskLike }>(
    `/api/scheduled-tasks/${encodeURIComponent(id)}/pin`,
    { method: "DELETE" }
  );
}
