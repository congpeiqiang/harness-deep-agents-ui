"use client";

// 逐条明细抽屉：question / db / strategy / 五维分 / SQL / result_head / trace 链接。
import { ExternalLink, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SCORE_DIMS, dimValue, type ExperimentRecord } from "@/lib/experiment";

const STRATEGY_LABEL: Record<string, string> = {
  A: "策略A（语义库）",
  B: "策略B（直连）",
  C: "策略C（经验）",
  none: "未分层",
};

function shortId(s: string): string {
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s;
}

export default function ItemDetailDrawer({
  open,
  record,
  onClose,
}: {
  open: boolean;
  record: ExperimentRecord | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              #{record?.index ?? "?"}
            </span>
            {record?.label ?? "明细"}
          </DialogTitle>
        </DialogHeader>
        {!record ? (
          <p className="text-sm text-muted-foreground">无记录</p>
        ) : (
          <div className="space-y-4">
            {/* 概览徽章 */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700">
                {STRATEGY_LABEL[record.strategy ?? ""] ?? record.strategy ?? "未分层"}
              </span>
              {record.dataset_name && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  {record.dataset_name}
                </span>
              )}
              {record.db_name && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  {record.db_name}
                </span>
              )}
              {record.skill_ref && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  skill:{record.skill_ref}
                </span>
              )}
              {record.semantic && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  sem:{record.semantic}
                </span>
              )}
            </div>

            {/* 问题 */}
            <div>
              <p className="text-xs font-medium text-muted-foreground">问题</p>
              <p className="mt-0.5 text-sm leading-snug">{record.question || "（空）"}</p>
            </div>

            {/* 五维分 */}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">评估维度</p>
              <div className="flex flex-wrap gap-1.5">
                {SCORE_DIMS.map((d) => {
                  const v = dimValue(record, d.key);
                  return (
                    <span
                      key={d.key}
                      className="rounded border border-border bg-muted px-2 py-1 text-xs"
                    >
                      {d.label}{" "}
                      <span
                        className={
                          v === null
                            ? "text-muted-foreground"
                            : v >= 0.8
                              ? "text-emerald-600"
                              : v >= 0.4
                                ? "text-amber-600"
                                : "text-rose-600"
                        }
                      >
                        {v === null ? "—" : v.toFixed(3)}
                      </span>
                    </span>
                  );
                })}
              </div>
              {(record.reasons ?? []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {record.reasons!.map((r, i) => (
                    <span
                      key={i}
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* SQL */}
            {record.sql && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">SQL</p>
                <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                  {record.sql}
                </pre>
              </div>
            )}

            {/* 结果预览 */}
            {record.result_head && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">结果预览</p>
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">
                  {record.result_head.length > 3000
                    ? `${record.result_head.slice(0, 3000)}\n…（截断）`
                    : record.result_head}
                </pre>
              </div>
            )}

            {/* trace 链接 + 元信息 */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
              {record.trace_url ? (
                <a
                  href={record.trace_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-1 font-mono text-[10px] text-foreground hover:bg-accent"
                >
                  <ExternalLink className="size-3" />
                  trace {shortId(record.trace_id || "")}
                </a>
              ) : (
                record.trace_id && (
                  <span className="font-mono">trace {shortId(record.trace_id)}</span>
                )
              )}
              {record.run_name && (
                <span className="font-mono">{record.run_name}</span>
              )}
              {record.dataset_item_id && (
                <span className="font-mono">item {shortId(record.dataset_item_id)}</span>
              )}
              <button
                onClick={onClose}
                className="ml-auto inline-flex items-center gap-1 rounded p-1 hover:bg-accent"
                title="关闭"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
