"use client";

// 结果对比表：列 = reference（第一臂）+ candidates；行 = 评估器五维分 + no_sql/exec_fail 占比。
// 相对 reference 的差值做红/绿高亮（分数维度越高越好，占比维度越低越好）。
import { SCORE_DIMS, dimValue, type ExperimentRecord, type RunDetail } from "@/lib/experiment";
import { cn } from "@/lib/utils";

interface Row {
  key: string;
  label: string;
  /** 越高越好（分数）还是越低越好（占比） */
  higherIsBetter: boolean;
  fmt: (v: number) => string;
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function mean(recs: ExperimentRecord[], key: string): number | null {
  return avg(recs.map((r) => dimValue(r, key)));
}

function count(recs: ExperimentRecord[], pred: (r: ExperimentRecord) => boolean): number {
  return recs.filter(pred).length;
}

function pct(recs: ExperimentRecord[], pred: (r: ExperimentRecord) => boolean): number | null {
  if (recs.length === 0) return null;
  return count(recs, pred) / recs.length;
}

const FMT_1 = (v: number) => v.toFixed(3);
const FMT_2 = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function ResultCompareTable({ detail }: { detail: RunDetail }) {
  const items = detail.items ?? {};
  const arms = detail.arms ?? [];
  if (arms.length === 0) return null;

  const refName = arms[0].name;
  const candNames = arms.slice(1).map((a) => a.name);

  const rows: Row[] = [
    ...SCORE_DIMS.map((d) => ({ key: d.key, label: d.label, higherIsBetter: true, fmt: FMT_1 })),
    { key: "__no_sql", label: "未生成 SQL 占比", higherIsBetter: false, fmt: FMT_2 },
    { key: "__exec_fail", label: "执行失败占比", higherIsBetter: false, fmt: FMT_2 },
  ];

  const refRecs = items[refName] ?? [];
  const val = (name: string, row: Row): number | null => {
    const recs = items[name] ?? [];
    if (row.key === "__no_sql") return pct(recs, (r) => !r.sql || !r.sql.trim());
    if (row.key === "__exec_fail") return pct(recs, (r) => (dimValue(r, "sql_exec_success") ?? 0) === 0);
    return mean(recs, row.key);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted">
          <tr>
            <th className="px-3 py-2 font-medium">指标</th>
            <th className="px-3 py-2 text-right font-medium">{refName}（基准）</th>
            {candNames.map((n) => (
              <th key={n} className="px-3 py-2 text-right font-medium">{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const refV = val(refName, row);
            return (
              <tr key={row.key} className="border-t border-border/60">
                <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">
                  {refV === null ? "—" : row.fmt(refV)}
                </td>
                {candNames.map((n) => {
                  const v = val(n, row);
                  const diff = refV !== null && v !== null ? v - refV : null;
                  let cls = "";
                  if (diff !== null && Math.abs(diff) > 1e-9) {
                    const better =
                      row.higherIsBetter ? diff > 0 : diff < 0;
                    cls = better
                      ? "text-emerald-600"
                      : "text-rose-600";
                  }
                  return (
                    <td key={n} className={cn("px-3 py-1.5 text-right font-mono text-xs", cls)}>
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
        样本数：{arms.map((a) => `${a.name}=${(items[a.name] ?? []).length}`).join("，")}
      </div>
    </div>
  );
}
