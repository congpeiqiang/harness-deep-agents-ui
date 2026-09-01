"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useChatContext } from "@/providers/ChatProvider";
import { getConfig } from "@/lib/config";
import { listModelConfigs, type ModelInfo } from "@/lib/modelConfigs";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// 默认上下文窗口（与后端 model.py:169 ModelProfile(max_input_tokens=120000) 一致）
const DEFAULT_MAX_CONTEXT = 120_000;

// 配色阈值
const THRESHOLD_WARN = 0.5; // 50%+ 琥珀色
const THRESHOLD_DANGER = 0.8; // 80%+ 红色

// 颜色
const COLOR_SAFE = "hsl(160 60% 45%)"; // 蓝绿
const COLOR_WARN = "hsl(38 92% 50%)"; // 琥珀
const COLOR_DANGER = "hsl(0 72% 52%)"; // 红
const COLOR_TRACK = "hsl(0 0% 30%)"; // 深灰轨道

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

interface ContextRingProps {
  /** 当前选中的模型 ID（用于查找 context_window） */
  selectedModel?: string;
  /** 当前选中的 provider（用于查找 context_window） */
  selectedProvider?: string;
}

export function ContextRing({ selectedModel, selectedProvider }: ContextRingProps) {
  const { tokenStats, threadId } = useChatContext();
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<string | null>(null);

  // 当前上下文 token 数：取 steps 末步的 total_input_tokens
  const currentTokens = useMemo(() => {
    const steps = tokenStats?.steps;
    if (!steps || steps.length === 0) return 0;
    const last = steps[steps.length - 1];
    return last?.total_input_tokens ?? 0;
  }, [tokenStats]);

  // 上下文窗口上限：优先从 model_config 读取，否则用默认 120000
  const [maxContext, setMaxContext] = useState(DEFAULT_MAX_CONTEXT);
  React.useEffect(() => {
    let cancelled = false;
    listModelConfigs()
      .then((result) => {
        if (cancelled) return;
        if (!selectedProvider || !selectedModel) return;
        const providers = result.providers || [];
        const provider = providers.find((p: { name: string }) => p.name === selectedProvider);
        if (!provider) return;
        const model: ModelInfo | undefined = provider.models.find(
          (m: { id: string }) => m.id === selectedModel
        );
        if (model?.context_window && model.context_window > 0) {
          setMaxContext(model.context_window);
        } else {
          setMaxContext(DEFAULT_MAX_CONTEXT);
        }
      })
      .catch(() => {
        if (!cancelled) setMaxContext(DEFAULT_MAX_CONTEXT);
      });
    return () => { cancelled = true; };
  }, [selectedModel, selectedProvider]);

  // 计算占用比例（即使 currentTokens=0 也正常计算为 0）
  const usageFraction = currentTokens / maxContext;
  const usagePercent = Math.round(usageFraction * 100);

  // 颜色
  let color = COLOR_SAFE;
  if (usageFraction >= THRESHOLD_DANGER) color = COLOR_DANGER;
  else if (usageFraction >= THRESHOLD_WARN) color = COLOR_WARN;

  // SVG 参数
  const size = 28;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(usageFraction, 1));

  const handleCompact = useCallback(async () => {
    if (!threadId) return;
    if (usageFraction < THRESHOLD_WARN) return; // 低于 50% 不触发
    setCompacting(true);
    setCompactResult(null);
    try {
      const config = getConfig();
      const baseUrl = config?.deploymentUrl || "";
      if (!baseUrl) {
        setCompactResult("未配置部署地址");
        return;
      }
      const res = await fetch(
        `${baseUrl.replace(/\/$/, "")}/api/threads/${threadId}/compact`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data.ok && !data.skipped) {
        setCompactResult(
          `已压缩 ${data.summarized_count} 条消息，保留 ${data.preserved_count} 条`
        );
      } else if (data.skipped) {
        setCompactResult(data.reason || "无需压缩");
      } else {
        setCompactResult(data.error || "压缩失败");
      }
    } catch (e: any) {
      setCompactResult(`压缩失败: ${e?.message || "网络错误"}`);
    } finally {
      setCompacting(false);
      // 3 秒后清除结果提示
      setTimeout(() => setCompactResult(null), 3000);
    }
  }, [threadId, usageFraction]);

  const compactDisabled = usageFraction < THRESHOLD_WARN;
  const compactHint = compactDisabled
    ? "上下文充足，无需压缩"
    : compacting
      ? "压缩中..."
      : "点击压缩上下文";

  // 无数据时不渲染（放在所有 hooks 之后，避免 hooks 顺序问题）
  if (currentTokens <= 0) {
    return null;
  }

  const tooltipContent = (
    <div className="flex flex-col gap-1 text-xs">
      <div className="font-semibold">
        上下文占用 {usagePercent}%
      </div>
      <div>
        {formatTokens(currentTokens)} / {formatTokens(maxContext)} tokens
      </div>
      {tokenStats?.step_count ? (
        <div className="text-primary-foreground/70">
          {tokenStats.step_count} 步 · {tokenStats.steps?.length ?? 0} 次 LLM 调用
        </div>
      ) : null}
      <div className="text-primary-foreground/70">{compactHint}</div>
      {compactResult ? (
        <div className="mt-1 font-medium text-green-600 dark:text-green-400">
          {compactResult}
        </div>
      ) : null}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="relative inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          style={{ width: size, height: size }}
          onClick={handleCompact}
          disabled={compacting || compactDisabled}
          title={compactHint}
          aria-label={`上下文占用 ${usagePercent}%，${compactHint}`}
        >
          {/* 旋转动画（压缩中） */}
          <svg
            width={size}
            height={size}
            className={compacting ? "animate-spin" : undefined}
            viewBox={`0 0 ${size} ${size}`}
          >
            {/* 背景轨道 */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={COLOR_TRACK}
              strokeWidth={strokeWidth}
            />
            {/* 占用弧线 */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.3s ease" }}
            />
          </svg>
          {/* 百分比文字 */}
          <span
            className="absolute text-[9px] font-semibold leading-none"
            style={{ color }}
          >
            {usagePercent > 99 ? "!" : usagePercent}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}