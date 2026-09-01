"use client";

// 运行进度卡：2s 轮询 fetchRun，展示 stage / 进度条 / 错误。
// 终态（done/error/interrupted）通过 onStatus 通知父组件停止轮询并渲染结果。
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchRun, type RunDetail } from "@/lib/experiment";

const STAGE_LABEL: Record<string, string> = {
  queued: "排队中",
  loading_dataset: "装载查询集",
  running_arms: "运行臂",
  complete: "完成",
  failed: "失败",
};

function shortStamp(s: string): string {
  return s.length > 15 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

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

    tick();
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
  const isError = detail.status === "error";
  const isInterrupted = detail.status === "interrupted";

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          run {shortStamp(stamp)}
        </span>
        {isRunning ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
            <Loader2 className="size-3.5 animate-spin" />
            运行中
          </span>
        ) : isError ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
            <XCircle className="size-3.5" />
            失败
          </span>
        ) : isInterrupted ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="size-3.5" />
            超时中断
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="size-3.5" />
            完成
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {STAGE_LABEL[detail.stage] ?? detail.stage}
        </span>
      </div>

      {isRunning && prog && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {prog.current ? `当前：${prog.current}` : "准备中…"}
            </span>
            <span>
              {prog.done} / {prog.total} 臂
            </span>
          </div>
          <div className="mt-1.5 h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-sky-500 transition-all duration-500"
              )}
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
