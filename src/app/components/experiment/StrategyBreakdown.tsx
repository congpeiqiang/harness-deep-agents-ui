"use client";

// 策略分层表：rows = 臂，cols = 出现的策略（A/B/C/none + 未知，序稳定）。
// 每格 = 该臂该策略子集的真实统计：N 条 + 各评估维度的子集均值（scoreTone 上色）；
// 空子集 → —。修旧结构（列=策略条数、得分列却=整臂均值的误导口径）。
import { SCORE_DIMS, type RunDetail } from "@/lib/experiment";
import { cn } from "@/lib/utils";
import {
  collectStrategies,
  scoreText,
  scoreTone,
  strategyLabel,
  strategySubsetStats,
} from "@/lib/experimentStats";

export default function StrategyBreakdown({ detail }: { detail: RunDetail }) {
  const items = detail.items ?? {};
  const arms = detail.arms ?? [];
  if (arms.length === 0) return null;

  const strategies = collectStrategies(items);
  if (strategies.length === 0) return null;

  const hasData = arms.some((a) => (items[a.name] ?? []).length > 0);
  if (!hasData) return null;

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th className="px-3 py-2 font-medium">臂</th>
              {strategies.map((s) => (
                <th key={s} className="px-3 py-2 text-right font-medium">
                  {strategyLabel(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {arms.map((arm) => {
              const recs = items[arm.name] ?? [];
              return (
                <tr key={arm.name} className="border-t border-border/60">
                  <td className="px-3 py-1.5 align-top font-medium">
                    {arm.name}
                    <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                      {recs.length} 条
                    </span>
                  </td>
                  {strategies.map((s) => {
                    const st = strategySubsetStats(recs, s);
                    if (st.n === 0) {
                      return (
                        <td
                          key={s}
                          className="px-3 py-1.5 text-right text-muted-foreground/50"
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={s} className="px-3 py-1.5 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            N={st.n}
                          </span>
                          {SCORE_DIMS.map((d) => {
                            const v = st.perDimMean[d.key] ?? null;
                            return (
                              <span
                                key={d.key}
                                className="whitespace-nowrap font-mono text-[11px]"
                              >
                                <span className="mr-1 text-muted-foreground">
                                  {d.short}
                                </span>
                                <span
                                  className={cn("font-medium", scoreTone(v))}
                                >
                                  {scoreText(v, 2)}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        每格为该臂该策略子集的简单均值（含 N 条）；多数据集运行时为跨数据集的加权混合。
      </div>
    </div>
  );
}
