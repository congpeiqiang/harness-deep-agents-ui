"use client";

// 离线测试（AB Test）页面：数据集 × prompt 版本 × skill 版本 × 语义库版本。
// 布局（2026-09-02 重排）：
//   左栏只留历史（窄栏 w-80 + 状态 Tab 筛选）；主区二态切换——
//   默认「结果工作台」自动选中最近 run，header「新建实验」切到「配置向导」。
// 后端：src/api/experiment.py；API 客户端：src/lib/experiment.ts。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchRun, type RunDetail, type ExperimentRecord, type RunSummary } from "@/lib/experiment";
import { shortStamp } from "@/lib/experimentStats";
import ExperimentForm from "@/app/components/experiment/ExperimentForm";
import RunProgressCard from "@/app/components/experiment/RunProgressCard";
import RunSummaryCard from "@/app/components/experiment/RunSummaryCard";
import RunScoreOverview from "@/app/components/experiment/RunScoreOverview";
import ResultCompareTable from "@/app/components/experiment/ResultCompareTable";
import StrategyBreakdown from "@/app/components/experiment/StrategyBreakdown";
import ItemDetailTable from "@/app/components/experiment/ItemDetailTable";
import RunHistory from "@/app/components/experiment/RunHistory";
import ItemDetailDrawer from "@/app/components/experiment/ItemDetailDrawer";

export default function ExperimentPage() {
  // 主区二态：false = 结果工作台（默认），true = 新建实验向导
  const [composeOpen, setComposeOpen] = useState(false);
  const [activeStamp, setActiveStamp] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<ExperimentRecord | null>(null);
  // 提交/状态变更后 +1 → RunHistory 重挂载刷新
  const [historyKey, setHistoryKey] = useState(0);
  // RunHistory 当前 Tab 筛选结果（父页据此做自动选中 / 删除回落）
  const [filteredRuns, setFilteredRuns] = useState<RunSummary[]>([]);

  const loadRun = useCallback(async (stamp: string) => {
    setLoadingRun(true);
    setLoadError(null);
    setDetail(null);
    try {
      const d = await fetchRun(stamp);
      setDetail(d);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRun(false);
    }
  }, []);

  const onListChange = useCallback((runs: RunSummary[]) => {
    setFilteredRuns(runs);
  }, []);

  // 自动选中策略：按 started_at 降序取最新；active 缺失/不在当前筛选内 → 回落第一条。
  useEffect(() => {
    if (composeOpen) return;
    if (filteredRuns.length === 0) {
      if (activeStamp !== null || detail !== null || loadError !== null) {
        setActiveStamp(null);
        setDetail(null);
        setLoadError(null);
      }
      return;
    }
    const sorted = [...filteredRuns].sort((a, b) => {
      const ta = Date.parse(a.started_at || "");
      const tb = Date.parse(b.started_at || "");
      const ra = Number.isNaN(ta) ? -1 : ta;
      const rb = Number.isNaN(tb) ? -1 : tb;
      return rb - ra;
    });
    if (!activeStamp || !filteredRuns.some((r) => r.stamp === activeStamp)) {
      const pick = sorted[0];
      setActiveStamp(pick.stamp);
      void loadRun(pick.stamp);
    }
  }, [filteredRuns, composeOpen, activeStamp, detail, loadError, loadRun]);

  // 提交成功：切到新 stamp + 立即拉取（展示进度卡）+ 刷新历史列表
  const onSubmitted = useCallback(
    (stamp: string) => {
      setActiveStamp(stamp);
      setHistoryKey((k) => k + 1);
      setComposeOpen(false);
      void loadRun(stamp);
    },
    [loadRun]
  );

  // 进度卡回调：终态写入 detail，同时刷新历史（更新状态 pill）
  const onStatus = useCallback((d: RunDetail) => {
    setDetail(d);
    if (d.status !== "running") setHistoryKey((k) => k + 1);
  }, []);

  const onSelectHistory = useCallback(
    (stamp: string) => {
      setActiveStamp(stamp);
      void loadRun(stamp);
    },
    [loadRun]
  );

  const onDeleted = useCallback(
    (stamp: string) => {
      if (activeStamp === stamp) {
        setActiveStamp(null);
        setDetail(null);
        setLoadError(null);
      }
    },
    [activeStamp]
  );

  const arms = detail?.arms ?? [];
  const hasItems = (detail?.items
    ? arms.some((a) => (detail.items?.[a.name] ?? []).length > 0)
    : false);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            返回聊天
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="flex shrink-0 items-center gap-2 text-lg font-semibold">
            <FlaskConical className="size-5" />
            离线测试
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground md:block">
            数据集 × prompt 版本 × skill 版本 × 语义库版本 A/B 对比
          </p>
        </div>
        {composeOpen ? (
          <Button variant="outline" size="sm" onClick={() => setComposeOpen(false)}>
            <X className="mr-1.5 size-4" />
            返回工作台
          </Button>
        ) : (
          <Button size="sm" onClick={() => setComposeOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            新建实验
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左：历史（状态 Tab 筛选 + 自动选中） */}
        <aside className="w-80 shrink-0 border-r border-border bg-card/40 p-3">
          <div className="h-full overflow-y-auto rounded-lg">
            <RunHistory
              key={historyKey}
              activeStamp={activeStamp}
              onSelect={onSelectHistory}
              onDeleted={onDeleted}
              onListChange={onListChange}
            />
          </div>
        </aside>

        {/* 右：工作台 / 向导 二态 */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-muted/30 p-6">
          {composeOpen ? (
            <ExperimentForm onSubmitted={onSubmitted} onCancel={() => setComposeOpen(false)} />
          ) : activeStamp === null ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <FlaskConical className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">还没有查看的实验</p>
              <Button size="sm" onClick={() => setComposeOpen(true)}>
                <Plus className="mr-1.5 size-4" />
                新建实验
              </Button>
              <p className="text-xs text-muted-foreground">
                提交后自动打开进度，或在左侧历史中选择一个 run
              </p>
            </div>
          ) : loadingRun ? (
            <div className="flex h-full items-center justify-center">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载 run {shortStamp(activeStamp)} …
              </span>
            </div>
          ) : loadError ? (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-md rounded-lg border border-rose-200 bg-rose-50 p-5 text-center">
                <p className="text-sm font-medium text-rose-700">
                  读取 run {shortStamp(activeStamp)} 失败
                </p>
                <p className="mt-1 break-all font-mono text-xs text-rose-600">
                  {loadError}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 border-rose-200 text-rose-700 hover:bg-rose-100"
                  onClick={() => void loadRun(activeStamp)}
                >
                  重试
                </Button>
              </div>
            </div>
          ) : detail && detail.status === "running" ? (
            <div className="mx-auto max-w-2xl space-y-4">
              <RunProgressCard stamp={activeStamp} onStatus={onStatus} />
              <p className="text-xs text-muted-foreground">
                运行完成后自动展示对比结果（可稍后从左侧历史重新打开）。
              </p>
            </div>
          ) : detail ? (
            <div className="mx-auto max-w-5xl space-y-5">
              <RunSummaryCard detail={detail} />

              {!hasItems ? (
                <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                  该 run 无逐条数据
                </p>
              ) : (
                <>
                  <section className="space-y-2">
                    <RunScoreOverview detail={detail} />
                  </section>
                  <section className="space-y-2">
                    <h2 className="text-sm font-medium">核心评分对比</h2>
                    <ResultCompareTable detail={detail} />
                  </section>
                  <section className="space-y-2">
                    <h2 className="text-sm font-medium">策略分层</h2>
                    <StrategyBreakdown detail={detail} />
                  </section>
                  <section className="space-y-2">
                    <ItemDetailTable
                      items={detail.items ?? {}}
                      arms={arms}
                      onOpen={setDrawer}
                    />
                  </section>
                </>
              )}
            </div>
          ) : null}
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
