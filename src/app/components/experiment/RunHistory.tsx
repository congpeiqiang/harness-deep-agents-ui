"use client";

// 历史 run 列表：stamp / status / gate，点击载入与当前并排对比；可删除（hover 显示）。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { listRuns, deleteRun, type RunStatus, type RunSummary } from "@/lib/experiment";

const STATUS_STYLE: Record<RunStatus, string> = {
  running: "bg-sky-100 text-sky-700",
  done: "bg-emerald-100 text-emerald-700",
  error: "bg-rose-100 text-rose-700",
  interrupted: "bg-amber-100 text-amber-700",
};

const STATUS_LABEL: Record<RunStatus, string> = {
  running: "运行中",
  done: "完成",
  error: "失败",
  interrupted: "中断",
};

function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export default function RunHistory({
  activeStamp,
  onSelect,
  onDeleted,
}: {
  activeStamp: string | null;
  onSelect: (stamp: string) => void;
  onDeleted?: (stamp: string) => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setRuns(await listRuns());
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (stamp: string) => {
    if (!window.confirm(`删除实验 ${stamp}？其结果明细文件将一并删除，不可恢复。`)) {
      return;
    }
    setDeleting(stamp);
    try {
      await deleteRun(stamp);
      setRuns((prev) => prev.filter((r) => r.stamp !== stamp));
      onDeleted?.(stamp);
      toast.success("已删除实验");
    } catch (e) {
      toast.error(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">历史实验</h2>
        <button
          onClick={refresh}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          title="刷新"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>
      <div className="max-h-[28rem] overflow-y-auto p-1.5">
        {loading && runs.length === 0 ? (
          <p className="flex items-center gap-1.5 p-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            加载中…
          </p>
        ) : runs.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">暂无实验记录</p>
        ) : (
          runs.map((r) => (
            <div
              key={r.stamp}
              className={cn(
                "group mb-1 flex w-full items-start rounded-md border p-2 transition-colors",
                activeStamp === r.stamp
                  ? "border-foreground/40 bg-accent"
                  : "border-border hover:bg-accent/50"
              )}
            >
              <button
                onClick={() => onSelect(r.stamp)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      STATUS_STYLE[r.status]
                    )}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                  {r.gate && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        r.gate.passed
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-rose-50 text-rose-600"
                      )}
                    >
                      {r.gate.passed ? "PASS" : "FAIL"}
                    </span>
                  )}
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {r.stamp}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                  {(r.arms ?? []).map((a) => (
                    <span
                      key={a.name}
                      className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                    >
                      {a.name}
                      {a.skill_ref ? ` · skill:${a.skill_ref}` : ""}
                      {a.semantic_ref ? ` · sem:${a.semantic_ref}` : ""}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{r.dataset || "—"}</span>
                  <span>{fmtTime(r.started_at)}</span>
                </div>
              </button>
              <button
                onClick={() => void handleDelete(r.stamp)}
                disabled={deleting === r.stamp}
                className="ml-1 self-start rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                title="删除此实验"
              >
                {deleting === r.stamp ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
