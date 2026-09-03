"use client";

// 结果工作台的第一层：每臂一卡，展示整臂样本数 + 4 个评估维度的整体均值。
// 附注：整臂聚合；多数据集时按数据集分块的口径见下方「核心评分对比」。
import { SCORE_DIMS, type RunDetail } from "@/lib/experiment";
import { cn } from "@/lib/utils";
import {
  datasetUnion,
  meanByDim,
  scoreText,
  scoreTone,
} from "@/lib/experimentStats";

export default function RunScoreOverview({ detail }: { detail: RunDetail }) {
  const arms = detail.arms ?? [];
  const items = detail.items ?? {};
  const datasets = datasetUnion(detail);

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {arms.map((arm) => {
          const recs = items[arm.name] ?? [];
          const perDim = meanByDim(recs);
          return (
            <div
              key={arm.name}
              className="rounded-lg border border-border bg-card p-3 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-foreground/90 px-1.5 py-0.5 text-[10px] font-medium text-background">
                  {arm.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {recs.length} 条样本
                </span>
                {arm.semantic_ref && (
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    sem:{arm.semantic_ref}
                  </span>
                )}
                {arm.skill_ref && (
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    skill:{arm.skill_ref}
                  </span>
                )}
              </div>
              {recs.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">无记录</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SCORE_DIMS.map((d) => {
                    const v = perDim[d.key];
                    return (
                      <span
                        key={d.key}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1"
                        title={d.label}
                      >
                        <span className="text-[10px] text-muted-foreground">
                          {d.short}
                        </span>
                        <span className={cn("font-mono text-xs", scoreTone(v))}>
                          {scoreText(v, 2)}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {datasets.length > 1 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          上方为整臂全样本聚合；多数据集时各数据集的独立均值见下方「核心评分对比」。
        </p>
      )}
    </div>
  );
}
