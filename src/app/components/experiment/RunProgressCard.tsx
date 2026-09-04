"use client";

// 运行进度卡：2s 轮询 fetchRun，展示 stage / 进度条 / 错误 / 停止按钮。
// 运行中（running/cancelling）轮询不停；终态（done/error/interrupted/cancelled）通过
// onStatus 通知父组件停止轮询并渲染结果。停止走 POST /runs/{stamp}/cancel（cooperative：
// 后端写标记，每题/每臂断点干净退出，已完成部分保留）。状态/阶段统一收编 experimentStats。
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchRun,
  cancelRun,
  type RunDetail,
  type RunStatus,
} from "@/lib/experiment";
import { RUN_STATUS_META, STAGE_LABEL, shortStamp } from "@/lib/experimentStats";

const STATUS_ICON: Record<RunStatus, ReactNode> = {
  running: <Loader2 className="size-3.5 animate-spin" />,
  cancelling: <Loader2 className="size-3.5 animate-spin" />,
  done: <CheckCircle2 className="size-3.5" />,
  error: <XCircle className="size-3.5" />,
  interrupted: <AlertTriangle className="size-3.5" />,
  cancelled: <Square className="size-3.5" />,
};

export default function RunProgressCard({
  stamp,
  onStatus,
}: {
  stamp: string;
  onStatus: (d: RunDetail) => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const d = await fetchRun(stamp);
        if (stopped) return;
        setDetail(d);
        // running + cancelling（已点停止，等待当前题自然收尾）都继续轮询；
        // 其余为终态 → 交还父组件切换视图
        if (d.status !== "running" && d.status !== "cancelling") {
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

  const handleStop = async () => {
    setStopping(true);
    try {
      await cancelRun(stamp);
      // 后端状态将转 cancelling → cancelled，轮询自会衔接；无需本地改 detail
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 409「已结束」= run 恰在点击时自然完成（正常竞态），轮询会切到终态视图
      if (!msg.includes("已结束")) {
        toast.error(`停止失败: ${msg}`);
      }
    } finally {
      setStopping(false);
    }
  };

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
  const active = detail.status === "running" || detail.status === "cancelling";
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
        {detail.status === "running" && (
          <button
            onClick={() => void handleStop()}
            disabled={stopping}
            className="ml-auto inline-flex items-center gap-1 rounded border border-rose-300 px-2 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="停止实验：当前这一题跑完后即停，已完成部分保留"
          >
            {stopping ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Square className="size-3" />
            )}
            {stopping ? "停止中…" : "停止"}
          </button>
        )}
      </div>

      {/* 实验级描述（提交时填写，整轮一条） */}
      {detail.description ? (
        <div className="mt-2 rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5 text-xs leading-relaxed text-foreground/80">
          <span className="mr-1.5 font-medium text-muted-foreground">描述</span>
          {detail.description}
        </div>
      ) : null}

      {/* run 级统一模型（与聊天所选一致；旧 run 无此字段为空则隐藏） */}
      {detail.model_label ? (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground">
          <span className="font-medium">模型</span>
          <span className="font-mono">{detail.model_label}</span>
        </div>
      ) : null}

      {active && prog && (
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
