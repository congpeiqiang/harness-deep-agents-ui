"use client";

// 核心评分对比表：rows = 4 个评估维度均值 + 未生成 SQL 占比 + 执行失败占比；
// cols = 第一臂（基准 ref）+ 候选臂（cand）。
// 口径（2026-09-02 拍板）：一切值按 per-(dataset, arm) 子集聚合——多数据集运行时
// 每数据集一块独立小表（标题注明），单数据集退化为一张表。exec_fail 分母 = 有非空
// SQL 的记录，与 no_sql 不交叠（修旧 `(dimValue ?? 0) === 0` 双计数 bug）。
// 相对基准的差值红/绿 ▲▼：分数维度越高越好，占比维度越低越好。
import { SCORE_DIMS, type ExperimentRecord, type RunDetail } from "@/lib/experiment";
import { cn } from "@/lib/utils";
import {
  execFailRate,
  mean,
  noSqlRate,
  groupByDataset,
} from "@/lib/experimentStats";

interface Row {
  key: string;
  label: string;
  higherIsBetter: boolean;
  fmt: (v: number) => string;
}

const FMT_1 = (v: number) => v.toFixed(3);
const FMT_2 = (v: number) => `${(v * 100).toFixed(1)}%`;

const ROWS: Row[] = [
  ...SCORE_DIMS.map((d) => ({
    key: d.key,
    label: d.label,
    higherIsBetter: true,
    fmt: FMT_1,
  })),
  { key: "__no_sql", label: "未生成 SQL 占比", higherIsBetter: false, fmt: FMT_2 },
  { key: "__exec_fail", label: "执行失败占比", higherIsBetter: false, fmt: FMT_2 },
];

function rowValue(recs: ExperimentRecord[], row: Row): number | null {
  if (row.key === "__no_sql") return noSqlRate(recs);
  if (row.key === "__exec_fail") return execFailRate(recs);
  return mean(recs, row.key);
}

function BlockTable({
  armNames,
  recsByArm,
}: {
  armNames: string[];
  recsByArm: (name: string) => ExperimentRecord[];
}) {
  const refName = armNames[0];
  const candNames = armNames.slice(1);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted">
          <tr>
            <th className="px-3 py-2 font-medium">指标</th>
            <th className="px-3 py-2 text-right font-medium">
              {refName}（基准）
            </th>
            {candNames.map((n) => (
              <th key={n} className="px-3 py-2 text-right font-medium">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const refRecs = recsByArm(refName);
            const refV = rowValue(refRecs, row);
            return (
              <tr key={row.key} className="border-t border-border/60">
                <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">
                  {refV === null ? "—" : row.fmt(refV)}
                </td>
                {candNames.map((n) => {
                  const v = rowValue(recsByArm(n), row);
                  const diff = refV !== null && v !== null ? v - refV : null;
                  let cls = "";
                  if (diff !== null && Math.abs(diff) > 1e-9) {
                    const better = row.higherIsBetter ? diff > 0 : diff < 0;
                    cls = better ? "text-emerald-600" : "text-rose-600";
                  }
                  return (
                    <td
                      key={n}
                      className={cn("px-3 py-1.5 text-right font-mono text-xs", cls)}
                    >
                      {v === null ? (
                        "—"
                      ) : (
                        <>
                          {row.fmt(v)}
                          {diff !== null && (
                            <span className="ml-1">
                              {diff > 0 ? "▲" : diff < 0 ? "▼" : "="}
                              {Math.abs(diff).toFixed(3)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        样本数：{armNames.map((n) => `${n}=${recsByArm(n).length}`).join("，")}
      </div>
    </div>
  );
}

export default function ResultCompareTable({ detail }: { detail: RunDetail }) {
  const items = detail.items ?? {};
  const arms = detail.arms ?? [];
  if (arms.length === 0) return null;
  const armNames = arms.map((a) => a.name);

  // 每臂的 (dataset → rows) 映射；dataset 缺失归「未标注数据集」（与明细表同口径）
  const byArmDataset: Record<string, Record<string, ExperimentRecord[]>> = {};
  for (const name of armNames) {
    const m: Record<string, ExperimentRecord[]> = {};
    for (const g of groupByDataset(items[name] ?? [])) m[g.dataset] = g.rows;
    byArmDataset[name] = m;
  }

  // 数据集并集：按臂顺序首次出现
  const datasets: string[] = [];
  for (const name of armNames) {
    for (const ds of Object.keys(byArmDataset[name])) {
      if (!datasets.includes(ds)) datasets.push(ds);
    }
  }
  if (datasets.length === 0) return null;

  const blockProps = (ds: string) => ({
    armNames,
    recsByArm: (name: string) => byArmDataset[name]?.[ds] ?? [],
  });

  // 多数据集：每块一个小标题；单数据集不重复标题（退化为旧形态）
  return datasets.length === 1 ? (
    <BlockTable {...blockProps(datasets[0])} />
  ) : (
    <div className="space-y-3">
      {datasets.map((ds) => (
        <div key={ds}>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            数据集：{ds}
          </p>
          <BlockTable {...blockProps(ds)} />
        </div>
      ))}
    </div>
  );
}
