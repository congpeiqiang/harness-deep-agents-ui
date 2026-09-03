"use client";

// run 摘要卡：状态 pill + 阶段 + 耗时 + stamp + 起止时间 + 数据集 chips +
// 每臂样本数与版本 meta + 门禁 +（error/interrupted）真实 error 全文显性化。
import { CheckCircle2, Loader2, XCircle, AlertTriangle, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ArmDef, type RunDetail } from "@/lib/experiment";
import {
  RUN_STATUS_META,
  fmtClock,
  fmtDuration,
  groupByDataset,
  shortStamp,
  stageLabel,
} from "@/lib/experimentStats";
import GateBadge from "@/app/components/experiment/GateBadge";

const STATUS_ICON = {
  running: <Loader2 className="size-3.5 animate-spin" />,
  cancelling: <Loader2 className="size-3.5 animate-spin" />,
  done: <CheckCircle2 className="size-3.5" />,
  error: <XCircle className="size-3.5" />,
  interrupted: <AlertTriangle className="size-3.5" />,
  cancelled: <Square className="size-3.5" />,
} as const;

function ArmMeta({ arm, count }: { arm: ArmDef; count: number }) {
  const bits: string[] = [];
  if (arm.prompt_label) bits.push(`prompt:${arm.prompt_label}`);
  if (arm.skill_ref) bits.push(`skill:${arm.skill_ref}`);
  if (arm.semantic_ref) bits.push(`sem:${arm.semantic_ref}`);
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <span className="shrink-0 rounded bg-foreground/90 px-1.5 py-0.5 text-[10px] font-medium text-background">
        {arm.name}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{count} 条</span>
      <span className="truncate font-mono text-[10px] text-muted-foreground">
        {bits.length > 0
          ? bits.join(" · ")
          : "全默认（生产 prompt / 磁盘 skill / 当前 HEAD）"}
      </span>
    </div>
  );
}

export default function RunSummaryCard({ detail }: { detail: RunDetail }) {
  const arms = detail.arms ?? [];
  const items = detail.items ?? {};
  const running = detail.status === "running";
  const isFailure = detail.status === "error" || detail.status === "interrupted";
  const statusMeta = RUN_STATUS_META[detail.status] ?? RUN_STATUS_META.error;

  // 数据集并集 + 每数据集跨臂样本总数（保留臂顺序首次出现）
  const dsOrder: string[] = [];
  const dsTotal = new Map<string, number>();
  for (const arm of arms) {
    for (const g of groupByDataset(items[arm.name] ?? [])) {
      if (!dsOrder.includes(g.dataset)) dsOrder.push(g.dataset);
      dsTotal.set(g.dataset, (dsTotal.get(g.dataset) ?? 0) + g.rows.length);
    }
  }
  const total = arms.reduce((acc, a) => acc + (items[a.name] ?? []).length, 0);

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      {/* 顶行：stamp + 状态 pill + 阶段 + 耗时 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          run {shortStamp(detail.stamp)}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium",
            statusMeta.className
          )}
        >
          {STATUS_ICON[detail.status]}
          {statusMeta.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {stageLabel(detail.stage)}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          耗时 {fmtDuration(detail.started_at, detail.finished_at, running)}
        </span>
      </div>

      {/* 时间行 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>开始 {fmtClock(detail.started_at)}</span>
        <span>结束 {fmtClock(detail.finished_at)}</span>
        {!running && (
          <span className="font-mono text-[10px]">{detail.stamp}</span>
        )}
      </div>

      {/* 数据集 + 样本量 */}
      {dsOrder.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {dsOrder.map((ds) => (
            <span
              key={ds}
              className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
            >
              {ds} · {dsTotal.get(ds) ?? 0} 条
            </span>
          ))}
          {arms.length > 0 && (
            <span className="text-muted-foreground/70">共 {total} 条样本</span>
          )}
        </div>
      )}

      {/* 每臂 meta */}
      {arms.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {arms.map((a) => (
            <ArmMeta key={a.name} arm={a} count={(items[a.name] ?? []).length} />
          ))}
        </div>
      )}

      {/* 门禁 */}
      {detail.gate && (
        <div className="mt-2.5 border-t border-border/60 pt-2.5">
          <GateBadge gate={detail.gate} />
        </div>
      )}

      {/* 手动停止：非失败，展示保留的已完成部分 */}
      {detail.status === "cancelled" && (
        <p className="mt-2.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          已按你的停止请求终止，仅展示停止前已完成的样本（共 {total} 条）。
        </p>
      )}

      {/* 错误显性化：真实 error 全文（替代旧「不存在或读取失败」吞错） */}
      {isFailure && (
        <div className="mt-2.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-xs font-medium text-rose-700">
            实验{detail.status === "error" ? "失败" : "被中断"}
          </p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-rose-600">
            {detail.error || "（后端未返回错误详情）"}
          </pre>
        </div>
      )}
    </div>
  );
}
