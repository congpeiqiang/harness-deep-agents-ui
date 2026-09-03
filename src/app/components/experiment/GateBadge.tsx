"use client";

// 门禁徽章：双臂对比 PASS / FAIL + failures 原因。
// ref/cand 与判定结果均沿用后端原样返回，不做本地推测。
import { ShieldCheck, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GateResult } from "@/lib/experiment";

export default function GateBadge({ gate }: { gate: GateResult | null }) {
  if (!gate) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        单臂实验，不触发门禁
      </span>
    );
  }
  const passed = gate.passed;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold",
          passed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
        )}
      >
        {passed ? <ShieldCheck className="size-4" /> : <ShieldX className="size-4" />}
        门禁 {passed ? "PASS" : "FAIL"}
      </span>
      <span className="text-xs text-muted-foreground">
        判定基准 {gate.ref} 对候选 {gate.cand}（阈值 ±{gate.threshold}）
      </span>
      {gate.failures.length > 0 && (
        <div className="mt-1 w-full">
          {gate.failures.map((f, i) => (
            <p key={i} className="text-xs text-rose-600">
              {f}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
