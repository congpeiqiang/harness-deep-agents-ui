"use client";

// 运行状态 pill：历史 / 摘要 / 进度等处的统一状态色表（RUN_STATUS_META 唯一来源）。
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/experiment";
import { RUN_STATUS_META } from "@/lib/experimentStats";

export default function RunStatusBadge({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const meta = RUN_STATUS_META[status] ?? RUN_STATUS_META.error;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
        meta.className,
        className
      )}
    >
      {meta.label}
    </span>
  );
}
