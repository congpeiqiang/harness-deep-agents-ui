"use client";

// 历史 run 列表：stamp / status / gate，点击载入该 run 结果；可删除（hover 显示）。
// 状态 pill 用 RunStatusBadge（RUN_STATUS_META 统一色表）；顶部 Tab 按状态筛选。
// 筛选后的列表通过 onListChange 上报父页，父页据以做「自动选中/删除回落」。
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { listRuns, deleteRun, type RunSummary } from "@/lib/experiment";
import { fmtClock } from "@/lib/experimentStats";
import RunStatusBadge from "@/app/components/experiment/RunStatusBadge";

type TabKey = "" | "running" | "done" | "error" | "cancelled";

const TABS: { key: TabKey; label: string }[] = [
  { key: "", label: "全部" },
  { key: "running", label: "运行中" },
  { key: "done", label: "完成" },
  { key: "error", label: "失败" },
  { key: "cancelled", label: "已停止" },
];

function matchesTab(r: RunSummary, tab: TabKey): boolean {
  if (!tab) return true;
  // 「运行中」tab 收纳 running + cancelling（点停止后到终态前仍算运行中）
  if (tab === "running") {
    return r.status === "running" || r.status === "cancelling";
  }
  // 「失败」tab 收纳 error + interrupted（pill 内仍用「中断」文案区分）
  if (tab === "error") {
    return r.status === "error" || r.status === "interrupted";
  }
  // 「已停止」tab 只收手动停止的 cancelled（与「中断」超时兜底分开）
  if (tab === "cancelled") {
    return r.status === "cancelled";
  }
  return r.status === tab;
}

export default function RunHistory({
  activeStamp,
  onSelect,
  onDeleted,
  onListChange,
}: {
  activeStamp: string | null;
  onSelect: (stamp: string) => void;
  onDeleted?: (stamp: string) => void;
  /** 当前 Tab 筛选后的列表，父页据此做自动选中 / 删除回落。 */
  onListChange?: (runs: RunSummary[]) => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [tab, setTab] = useState<TabKey>("");
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

  const filtered = useMemo(
    () => runs.filter((r) => matchesTab(r, tab)),
    [runs, tab]
  );

  useEffect(() => {
    void refresh();
  }, []);

  // 当前 Tab 筛选结果上报父页（含初始空表与删除后的回落）
  useEffect(() => {
    onListChange?.(filtered);
  }, [filtered, onListChange]);

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

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">历史实验</h2>
        <button
          onClick={() => void refresh()}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          title="刷新"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* 状态 Tab 筛选（失败 tab 含中断，pill 中中断仍 amber 区分） */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {TABS.map((t) => {
          const count = t.key
            ? runs.filter((r) => matchesTab(r, t.key)).length
            : runs.length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                tab === t.key
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {t.label}
              <span className="ml-1 font-mono text-[10px] opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && runs.length === 0 ? (
          <p className="flex items-center gap-1.5 p-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            加载中…
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            {runs.length === 0 ? "暂无实验记录" : "当前筛选下无实验"}
          </p>
        ) : (
          filtered.map((r) => (
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
                  <RunStatusBadge status={r.status} />
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
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-[10px] text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span>{r.dataset || "—"}</span>
                    {r.model_label && (
                      <span className="truncate font-mono text-muted-foreground/80">
                        模型 {r.model_label}
                      </span>
                    )}
                  </span>
                  <span>{fmtClock(r.started_at)}</span>
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
