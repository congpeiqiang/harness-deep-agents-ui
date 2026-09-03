"use client";

// 运行进度卡：2s 轮询 fetchRun，展示 stage / 进度条 / 错误。
// 终态（done/error/interrupted）通过 onStatus 通知父组件停止轮询并渲染结果。
// 状态/阶段/短 stamp 文案统一收编自 experimentStats（RUN_STATUS_META / STAGE_LABEL）。
import { useEffect, useState, type ReactNode } from "react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchRun, type RunDetail, type RunStatus } from "@/lib/experiment";
import { RUN_STATUS_META, STAGE_LABEL, shortStamp } from "@/lib/experimentStats";

const STATUS_ICON: Record<RunStatus, ReactNode> = {
  running: <Loader2 className="size-3.5 animate-spin" />,
  done: <CheckCircle2 className="size-3.5" />,
  error: <XCircle className="size-3.5" />,
  interrupted: <AlertTriangle className="size-3.5" />,
};

export default function RunProgressCard({
  stamp,
  onStatus,
}: {
  stamp: string;
  onStatus: (d: RunDetail) => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const d = await fetchRun(stamp);
        if (stopped) return;
        setDetail(d);
        if (d.status !== "running") {
          onStatus(d);
          return;
        }
      } catch (e) {
        if (stopped) return;
        setDetail((prev) =>
          prev
            ? { ...prev, error: e instanceof Error ? e.message : String(e) }
            : prev
        );
      }
      timer = setTimeout(tick, 2000);
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [stamp, onStatus]);

  if (!detail) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在获取运行状态…
      </div>
    );
  }

  const prog = detail.progress;
  const pct =
    prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
  const isRunning = detail.status === "running";
  const statusMeta = RUN_STATUS_META[detail.status] ?? RUN_STATUS_META.error;

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          run {shortStamp(stamp)}
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
          {STAGE_LABEL[detail.stage] ?? detail.stage}
        </span>
      </div>

      {isRunning && prog && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{prog.current ? `当前：${prog.current}` : "准备中…"}</span>
            <span>
              {prog.done} / {prog.total} 臂
            </span>
          </div>
          <div className="mt-1.5 h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {detail.error && (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-600">
          {detail.error}
        </p>
      )}
    </div>
  );
}
