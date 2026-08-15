"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  /** 完整思考文本（流式中逐 token 增长） */
  content: string;
  /** 是否正在流式生成（思考块实时滚动；生成完自动折叠成一行标题） */
  streaming?: boolean;
}

/**
 * "深度思考"折叠块（参考 DeepSeek 官方 UI）。
 *
 * 展示在 AI 回复正文上方，内容来自 message.additional_kwargs.reasoning_content：
 * - 流式中：展开显示实时思考文本，正文随内容增长自动滚到底部
 * - 生成完成：自动折叠成一行标题（DeepSeek 行为），可点击展开回看全文
 * - 用户手动点过展开/收起后，尊重用户状态，不再自动折叠
 */
export function ThinkingBlock({ content, streaming = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(streaming);
  const [pinned, setPinned] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 生成完成（streaming 由 true → false）且用户未手动操作时，自动收起
  useEffect(() => {
    if (!streaming && !pinned) {
      setExpanded(false);
    }
  }, [streaming, pinned]);

  // 流式中内容增长时，让思考正文自动滚到底部
  useEffect(() => {
    if (!streaming || !expanded) return;
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content, streaming, expanded]);

  const toggle = () => {
    setPinned(true);
    setExpanded((v) => !v);
  };

  const showBody = expanded;

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden="true">🧠</span>
        <span className="font-medium">深度思考</span>
        <span className="ml-auto shrink-0">
          {streaming ? "思考中..." : showBody ? "▾" : "▸"}
        </span>
      </button>
      {showBody && (
        <div
          ref={bodyRef}
          className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap border-t border-border/40 px-3 py-2 text-sm italic leading-relaxed text-muted-foreground"
        >
          {content}
          {streaming && (
            <span
              className="animate-pulse pl-0.5 text-primary"
              aria-hidden="true"
            >
              ▍
            </span>
          )}
        </div>
      )}
    </div>
  );
}
