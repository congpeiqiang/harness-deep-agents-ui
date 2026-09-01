"use client";

// 离线测试（AB Test）页面：数据集 × prompt 版本 × skill 版本 × 语义库版本。
// 后端：src/api/experiment.py；API 客户端：src/lib/experiment.ts。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchRun, SCORE_DIMS, dimValue, type RunDetail, type ExperimentRecord } from "@/lib/experiment";
import ExperimentForm from "@/app/components/experiment/ExperimentForm";
import RunProgressCard from "@/app/components/experiment/RunProgressCard";
import ResultCompareTable from "@/app/components/experiment/ResultCompareTable";
import StrategyBreakdown from "@/app/components/experiment/StrategyBreakdown";
import GateBadge from "@/app/components/experiment/GateBadge";
import RunHistory from "@/app/components/experiment/RunHistory";
import ItemDetailDrawer from "@/app/components/experiment/ItemDetailDrawer";

function shortStamp(s: string): string {
  return s.length > 15 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

// 单臂逐条明细行（可点开抽屉）
function RecordRow({
  record,
  onClick,
}: {
  record: ExperimentRecord;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="mb-1 w-full rounded-md border border-border p-2 text-left transition-colors hover:bg-accent/50"
    >
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-mono text-muted-foreground">#{record.index}</span>
        <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700">
          {record.strategy || "未分层"}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-snug">{record.question || "（空问题）"}</p>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
        {SCORE_DIMS.map((d) => {
          const v = dimValue(record, d.key);
          return (
            <span key={d.key} className="rounded bg-muted px-1 py-0.5 font-mono">
              {d.short}:{v === null ? "—" : v.toFixed(2)}
            </span>
          );
        })}
      </div>
    </button>
  );
}

export default function ExperimentPage() {
  const [activeStamp, setActiveStamp] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [drawer, setDrawer] = useState<ExperimentRecord | null>(null);
  // 提交后 +1 → RunHistory 重挂载刷新，立即显示运行中的 run
  const [historyKey, setHistoryKey] = useState(0);

  const loadRun = useCallback(async (stamp: string) => {
    setLoadingRun(true);
    setDetail(null);
    try {
      const d = await fetchRun(stamp);
      setDetail(d);
    } catch (e) {
      setDetail(null);
    } finally {
      setLoadingRun(false);
    }
  }, []);

  // 提交后：切到新 stamp 并立即拉取（展示进度卡）
  const onSubmitted = useCallback(
    (stamp: string) => {
      setActiveStamp(stamp);
      setHistoryKey((k) => k + 1); // 刷新历史列表，露出运行中的 run
      loadRun(stamp);
    },
    [loadRun]
  );

  // 历史选择
  const onSelectHistory = useCallback(
    (stamp: string) => {
      setActiveStamp(stamp);
      loadRun(stamp);
    },
    [loadRun]
  );

  const isRunning = detail?.status === "running";

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            返回聊天
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FlaskConical className="size-5" />
            离线测试
          </h1>
        </div>
        <p className="text-xs text-muted-foreground">
          数据集 × prompt 版本 × skill 版本 × 语义库版本 A/B 对比
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左：表单 + 历史 */}
        <aside className="w-[360px] shrink-0 overflow-y-auto border-r border-border p-4">
          <ExperimentForm onSubmitted={onSubmitted} />
          <div className="mt-4">
            <RunHistory
              key={historyKey}
              activeStamp={activeStamp}
              onSelect={onSelectHistory}
              onDeleted={(stamp) => {
                if (activeStamp === stamp) {
                  setActiveStamp(null);
                  setDetail(null);
                }
              }}
            />
          </div>
        </aside>

        {/* 右：运行进度 + 结果 */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {!activeStamp ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              左侧配置并提交实验，或从历史中选择一个 run 查看结果
            </div>
          ) : loadingRun ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载中…
            </div>
          ) : !detail ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              run {shortStamp(activeStamp)} 不存在或读取失败
            </div>
          ) : isRunning ? (
            <div className="mx-auto max-w-2xl space-y-4">
              <RunProgressCard stamp={activeStamp} onStatus={setDetail} />
              <p className="text-xs text-muted-foreground">
                运行完成后自动展示对比结果（可稍后从左侧历史重新打开）。
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  run {shortStamp(activeStamp)}
                </span>
                <GateBadge gate={detail.gate} />
              </div>
              {Object.keys(detail.items ?? {}).length === 0 ? (
                <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                  {detail.status === "error" || detail.status === "interrupted"
                    ? `实验未产出结果：${detail.error || "未知原因"}`
                    : "该 run 无结果数据"}
                </p>
              ) : (
                <>
                  <section>
                    <h2 className="mb-2 text-sm font-medium">核心评分对比</h2>
                    <ResultCompareTable detail={detail} />
                  </section>
                  <section>
                    <h2 className="mb-2 text-sm font-medium">策略分层</h2>
                    <StrategyBreakdown detail={detail} />
                  </section>
                  <section>
                    <h2 className="mb-2 text-sm font-medium">逐条明细</h2>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {(detail.arms ?? []).map((arm) => {
                        const recs = detail.items?.[arm.name] ?? [];
                        return (
                          <div key={arm.name}>
                            <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                                {arm.name}
                              </span>
                              <span>{recs.length} 条</span>
                              {arm.skill_ref && <span>skill:{arm.skill_ref}</span>}
                              {arm.semantic_ref && <span>sem:{arm.semantic_ref}</span>}
                            </p>
                            <div className="rounded-lg border border-border bg-card p-1.5 shadow-sm">
                              {recs.length === 0 ? (
                                <p className="p-3 text-xs text-muted-foreground">无记录</p>
                              ) : (
                                recs.map((r, i) => (
                                  <RecordRow
                                    key={i}
                                    record={r}
                                    onClick={() => setDrawer(r)}
                                  />
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <ItemDetailDrawer
        open={drawer !== null}
        record={drawer}
        onClose={() => setDrawer(null)}
      />
    </div>
  );
}
