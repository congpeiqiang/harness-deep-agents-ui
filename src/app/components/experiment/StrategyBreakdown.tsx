"use client";

// 策略分层明细：每臂 × 策略（A/B/C/none）条数 + 各维均值。
import {
  SCORE_DIMS,
  dimValue,
  type ExperimentRecord,
  type RunDetail,
} from "@/lib/experiment";

const STRATEGY_LABEL: Record<string, string> = {
  A: "策略A（语义库）",
  B: "策略B（直连）",
  C: "策略C（经验）",
  none: "未分层",
};

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function mean(recs: ExperimentRecord[], key: string): number | null {
  return avg(recs.map((r) => dimValue(r, key)));
}

export default function StrategyBreakdown({ detail }: { detail: RunDetail }) {
  const items = detail.items ?? {};
  const arms = detail.arms ?? [];
  if (arms.length === 0) return null;

  // 收集全部出现的策略值
  const strategies = new Set<string>();
  for (const recs of Object.values(items)) {
    for (const r of recs) strategies.add(r.strategy || "none");
  }
  const stratKeys = ["A", "B", "C", "none"].filter((s) => strategies.has(s));
  if (stratKeys.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-border bg-muted">
          <tr>
            <th className="px-3 py-2 font-medium">臂</th>
            {stratKeys.map((s) => (
              <th key={s} className="px-3 py-2 text-right font-medium">
                {STRATEGY_LABEL[s] ?? s}（条数）
              </th>
            ))}
            {SCORE_DIMS.map((d) => (
              <th key={d.key} className="px-3 py-2 text-right font-medium">
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {arms.map((arm) => {
            const recs = items[arm.name] ?? [];
            const byStrat = new Map<string, number>();
            for (const r of recs) {
              const k = r.strategy || "none";
              byStrat.set(k, (byStrat.get(k) ?? 0) + 1);
            }
            return (
              <tr key={arm.name} className="border-t border-border/60">
                <td className="px-3 py-1.5 font-medium">{arm.name}</td>
                {stratKeys.map((s) => (
                  <td key={s} className="px-3 py-1.5 text-right font-mono">
                    {byStrat.get(s) ?? 0}
                  </td>
                ))}
                {SCORE_DIMS.map((d) => {
                  const v = mean(recs, d.key);
                  return (
                    <td key={d.key} className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {v === null ? "—" : v.toFixed(3)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
