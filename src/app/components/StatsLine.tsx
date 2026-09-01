"use client";

import React from "react";
import { useChatContext } from "@/providers/ChatProvider";

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function StatsLine({ avgTtftMs }: { avgTtftMs?: number }) {
  const { tokenStats, messages } = useChatContext();

  if (!tokenStats || !tokenStats.step_count) return null;

  const {
    total_llm_ms = 0,
    total_input_tokens = 0,
    total_output_tokens = 0,
    total_cache_read_tokens = 0,
    total_reasoning_tokens = 0,
    step_count = 0,
  } = tokenStats;

  // 轮数 = 用户提问次数（human 消息数）
  const roundCount = (messages ?? []).filter(
    (m) => (m as { type?: string } | null)?.type === "human"
  ).length;

  const cacheRate =
    total_input_tokens > 0
      ? Math.round((total_cache_read_tokens / total_input_tokens) * 100)
      : 0;
  const tokPerSec =
    total_llm_ms > 0
      ? Math.round(total_output_tokens / (total_llm_ms / 1000))
      : 0;

  const parts: string[] = [];
  if (roundCount > 0) parts.push(`${roundCount} 轮`);
  parts.push(`${step_count} 步`);
  parts.push(`LLM ${formatMs(total_llm_ms)}`);
  if (avgTtftMs != null && avgTtftMs > 0)
    parts.push(`平均首 token ${formatMs(avgTtftMs)}`);
  if (tokPerSec > 0) parts.push(`${tokPerSec} tok/s`);
  if (total_cache_read_tokens > 0) parts.push(`缓存命中 ${cacheRate}%`);
  parts.push(`输入 ${formatTokens(total_input_tokens)} tok`);
  parts.push(`输出 ${formatTokens(total_output_tokens)} tok`);
  if (total_reasoning_tokens > 0)
    parts.push(`推理 ${formatTokens(total_reasoning_tokens)} tok`);

  return (
    <div className="flex flex-wrap items-center gap-x-2 border-t border-border/50 px-[18px] py-1.5 text-xs text-muted-foreground/70">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="font-semibold text-muted-foreground/60">|</span>}
          <span>{p}</span>
        </React.Fragment>
      ))}
    </div>
  );
}