// 离线测试页共用展示工具（纯函数 + 常量，无副作用、不 import React）。
// 集中聚合 / 配色 / 时长 / 文案，避免各组件重复实现与口径漂移。
//
// 口径统一（2026-09-02 拍板）：
// - 一切均值 = 子集简单平均；空子集或该 dim 缺失 → null（渲染为 —），缺失不进分母。
// - no_sql（无 SQL 占比）与 exec_fail（有 SQL 但执行失败占比）分母不同、不交叠：
//     no_sql     = 无非空 SQL 记录 / 总数
//     exec_fail  = (有非空 SQL 且 sql_exec_success < 1) / 有非空 SQL 记录
// - dataset 一律派生自 record.dataset_name（缺失归「未标注数据集」），不信拼接字符串。
// - 单值视图统一绝对阈值配色 scoreTone（≥0.8 emerald / ≥0.4 amber / <0.4 rose / null muted）；
//   对比表的 ▲▼ diff 红绿编码只由 ResultCompareTable 自行处理，两套配色不重叠。
import {
  SCORE_DIMS,
  type ExperimentRecord,
  type RunDetail,
  type RunStatus,
} from "@/lib/experiment";

// ── 展示字符串 ─────────────────────────────────────────

export function shortStamp(s: string): string {
  if (!s) return "";
  return s.length > 15 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

export function shortId(s: string): string {
  if (!s) return "";
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s;
}

export function fmtClock(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function fmtDuration(
  startedAt?: string,
  finishedAt?: string,
  running = false
): string {
  if (running) return "运行中";
  const a = Date.parse(startedAt || "");
  const b = Date.parse(finishedAt || "");
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "—";
  const total = Math.round((b - a) / 1000);
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`;
}

// ── 状态 / 阶段 ────────────────────────────────────────

export const RUN_STATUS_META: Record<
  RunStatus,
  { label: string; className: string }
> = {
  running: { label: "运行中", className: "bg-sky-100 text-sky-700" },
  cancelling: {
    label: "停止中…",
    className: "bg-amber-100 text-amber-700",
  },
  done: { label: "完成", className: "bg-emerald-100 text-emerald-700" },
  error: { label: "失败", className: "bg-rose-100 text-rose-700" },
  interrupted: { label: "中断", className: "bg-amber-100 text-amber-700" },
  cancelled: { label: "已停止", className: "bg-slate-100 text-slate-600" },
};

export const STAGE_LABEL: Record<string, string> = {
  queued: "排队中",
  loading_dataset: "装载查询集",
  running_arms: "运行臂",
  complete: "完成",
  failed: "失败",
  cancelled: "已停止",
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

// ── 策略 ──────────────────────────────────────────────

export const STRATEGY_LABEL: Record<string, string> = {
  A: "策略A（语义库）",
  B: "策略B（直连）",
  C: "策略C（经验）",
  none: "未分层",
};

export function normalizeStrategy(v?: string | null): string {
  const s = (v ?? "").trim();
  return s === "" ? "none" : s;
}

export function strategyLabel(v?: string | null): string {
  const k = normalizeStrategy(v);
  return STRATEGY_LABEL[k] ?? k;
}

/** 收集全部出现的策略值：先按 A/B/C/none，其余未知按首次出现序。 */
export function collectStrategies(
  items: Record<string, ExperimentRecord[]>
): string[] {
  const order = ["A", "B", "C", "none"];
  const seen: string[] = [];
  for (const recs of Object.values(items)) {
    for (const r of recs) {
      const k = normalizeStrategy(r.strategy);
      if (!seen.includes(k)) seen.push(k);
    }
  }
  const out: string[] = [];
  for (const k of order) if (seen.includes(k)) out.push(k);
  for (const k of seen) if (!out.includes(k)) out.push(k);
  return out;
}

// ── 聚合（简单平均；缺失 dim 不进分母；空 → null） ─────

export function mean(
  recs: ExperimentRecord[],
  key: string
): number | null {
  let sum = 0;
  let n = 0;
  for (const r of recs) {
    const v = r.scores?.[key];
    if (typeof v === "number") {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

export function meanByDim(
  recs: ExperimentRecord[]
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const d of SCORE_DIMS) out[d.key] = mean(recs, d.key);
  return out;
}

/** 无 SQL 记录占比 = 无非空 SQL / 总数（空 → null）。 */
export function noSqlRate(recs: ExperimentRecord[]): number | null {
  if (recs.length === 0) return null;
  let n = 0;
  for (const r of recs) if (!r.sql || !r.sql.trim()) n += 1;
  return n / recs.length;
}

/** 执行失败占比 = (有非空 SQL 且 sql_exec_success < 1) / 有非空 SQL 记录（空 → null）。
 * 分母只算有 SQL 的记录——与 noSqlRate 不交叠，修掉旧的 `(dimValue ?? 0) === 0`
 * 把无 SQL 记录也当执行失败的双计数 bug。 */
export function execFailRate(recs: ExperimentRecord[]): number | null {
  let withSql = 0;
  let failed = 0;
  for (const r of recs) {
    if (!r.sql || !r.sql.trim()) continue;
    withSql += 1;
    const v = r.scores?.["sql_exec_success"];
    if (typeof v !== "number" || v < 1) failed += 1;
  }
  return withSql === 0 ? null : failed / withSql;
}

export interface DatasetGroup {
  dataset: string;
  rows: ExperimentRecord[];
}

/** 按 record.dataset_name 分组（缺失归「未标注数据集」；保留首次出现序）。 */
export function groupByDataset(recs: ExperimentRecord[]): DatasetGroup[] {
  const order: string[] = [];
  const map = new Map<string, ExperimentRecord[]>();
  for (const r of recs) {
    const ds = (r.dataset_name ?? "").trim();
    const key = ds === "" ? "未标注数据集" : ds;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(r);
  }
  return order.map((ds) => ({ dataset: ds, rows: map.get(ds)! }));
}

/** 全部数据集并集（按臂顺序首次出现）——摘要/概览 chips 用。 */
export function datasetUnion(detail: RunDetail): string[] {
  const out: string[] = [];
  for (const arm of detail.arms ?? []) {
    for (const g of groupByDataset(detail.items?.[arm.name] ?? [])) {
      if (!out.includes(g.dataset)) out.push(g.dataset);
    }
  }
  return out;
}

export interface StrategyStats {
  n: number;
  /** 该策略子集内每维均值（dim 无值 → null，渲染 —）。 */
  perDimMean: Record<string, number | null>;
}

/** 指定策略子集的真实统计（每格口径——替换旧的「列=条数、得分列=整臂均值」误导结构）。 */
export function strategySubsetStats(
  recs: ExperimentRecord[],
  strat: string
): StrategyStats {
  const sub = recs.filter((r) => normalizeStrategy(r.strategy) === strat);
  return { n: sub.length, perDimMean: meanByDim(sub) };
}

// ── 评分展示（单值视图统一绝对阈值配色） ────────────────

/** 完整字面类名字典（Tailwind JIT 安全：禁止模板拼类名）。 */
const SCORE_TONES = {
  hi: "text-emerald-600",
  mid: "text-amber-600",
  lo: "text-rose-600",
  miss: "text-muted-foreground",
} as const;

export function scoreTone(v: number | null): string {
  if (v === null) return SCORE_TONES.miss;
  if (v >= 0.8) return SCORE_TONES.hi;
  if (v >= 0.4) return SCORE_TONES.mid;
  return SCORE_TONES.lo;
}

export function scoreText(v: number | null, digits = 3): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function pctText(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
