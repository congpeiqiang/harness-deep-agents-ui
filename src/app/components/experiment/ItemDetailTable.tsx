"use client";

// 逐条明细表：臂筛选 pill + 拍平排序（dataset → index → 臂序）+ 分页（20/页）。
// 行 = #index / 臂 / 数据集 / 问题(截断) / 4 维均值 / 策略；点击行打开抽屉看完整 SQL/结果/trace。
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SCORE_DIMS,
  dimValue,
  type ArmDef,
  type ExperimentRecord,
} from "@/lib/experiment";
import {
  scoreText,
  scoreTone,
  strategyLabel,
} from "@/lib/experimentStats";

const PAGE_SIZE = 20;

export default function ItemDetailTable({
  items,
  arms,
  onOpen,
}: {
  items: Record<string, ExperimentRecord[]>;
  arms: ArmDef[];
  onOpen: (rec: ExperimentRecord) => void;
}) {
  const [armFilter, setArmFilter] = useState<string>("");
  const [page, setPage] = useState(0);

  // 拍平：arm 顺序 × 每臂记录；按 (dataset_name, index, 臂序) 稳定排序，
  // dataset 缺失归「未标注数据集」——与对比表同一分组口径。
  const flat = useMemo(() => {
    const rows: { arm: string; rec: ExperimentRecord }[] = [];
    for (const arm of arms) {
      for (const rec of items[arm.name] ?? []) {
        rows.push({ arm: arm.name, rec });
      }
    }
    const armRank = new Map(arms.map((a, i) => [a.name, i]));
    const dsOf = (rec: ExperimentRecord) =>
      (rec.dataset_name ?? "").trim() || "未标注数据集";
    rows.sort((a, b) => {
      const d = dsOf(a.rec).localeCompare(dsOf(b.rec), "zh-CN");
      if (d !== 0) return d;
      const i = a.rec.index - b.rec.index;
      if (i !== 0) return i;
      return (armRank.get(a.arm) ?? 0) - (armRank.get(b.arm) ?? 0);
    });
    return rows;
  }, [items, arms]);

  const filtered = useMemo(
    () => (armFilter ? flat.filter((r) => r.arm === armFilter) : flat),
    [flat, armFilter]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // 筛选/数据变化时回到第一页，且钳制越界页
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const pageRows = filtered.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE
  );

  const showFilter = arms.length > 1;

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      {/* 头：标题 + 臂筛选 pill */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Table2 className="size-4 text-muted-foreground" />
          逐条明细
        </h3>
        {showFilter && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => {
                setArmFilter("");
                setPage(0);
              }}
              className={cn(
                "rounded px-2 py-1 text-xs",
                !armFilter
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              全部
            </button>
            {arms.map((a) => (
              <button
                key={a.name}
                onClick={() => {
                  setArmFilter(a.name);
                  setPage(0);
                }}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  armFilter === a.name
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="p-4 text-center text-xs text-muted-foreground">
          无明细记录
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-border bg-muted text-[11px]">
                <tr>
                  <th className="px-2 py-1.5 font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">臂</th>
                  <th className="px-2 py-1.5 font-medium">数据集</th>
                  <th className="px-2 py-1.5 font-medium">问题</th>
                  {SCORE_DIMS.map((d) => (
                    <th key={d.key} className="px-2 py-1.5 text-right font-medium">
                      {d.short}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 font-medium">策略</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ arm, rec }) => (
                  <tr
                    key={`${arm}-${rec.index}`}
                    onClick={() => onOpen(rec)}
                    className="cursor-pointer border-t border-border/60 transition-colors hover:bg-accent/40"
                  >
                    <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                      {rec.index}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="rounded bg-foreground/90 px-1.5 py-0.5 text-[10px] font-medium text-background">
                        {arm}
                      </span>
                    </td>
                    <td className="max-w-[120px] px-2 py-1.5">
                      <span
                        className="block truncate text-muted-foreground"
                        title={(rec.dataset_name ?? "").trim() || "未标注数据集"}
                      >
                        {(rec.dataset_name ?? "").trim() || "未标注数据集"}
                      </span>
                    </td>
                    <td className="max-w-[220px] px-2 py-1.5">
                      <span
                        className="block truncate"
                        title={rec.question || "（空问题）"}
                      >
                        {rec.question || "（空问题）"}
                      </span>
                    </td>
                    {SCORE_DIMS.map((d) => {
                      const v = dimValue(rec, d.key);
                      return (
                        <td key={d.key} className="px-2 py-1.5 text-right">
                          <span
                            className={cn(
                              "font-mono text-[11px]",
                              scoreTone(v)
                            )}
                          >
                            {scoreText(v, 2)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5">
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                        {strategyLabel(rec.strategy)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>
              共 {filtered.length} 条{armFilter ? ` · 臂 ${armFilter}` : ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page <= 0}
                className="rounded p-1 hover:bg-accent disabled:opacity-40"
                title="上一页"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span>
                {page + 1} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="rounded p-1 hover:bg-accent disabled:opacity-40"
                title="下一页"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
