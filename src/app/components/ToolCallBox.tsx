"use client";

import React, {
  useState,
  useMemo,
  useCallback,
  memo,
  useDeferredValue,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Terminal,
  AlertCircle,
  Loader2,
  CircleCheckBigIcon,
  StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolCall, ActionRequest, ReviewConfig } from "@/app/types/types";
import { extractInteractiveChartIframes, chartToolNames } from "@/app/utils/chart";
import { cn } from "@/lib/utils";
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";
import { ToolApprovalInterrupt } from "@/app/components/ToolApprovalInterrupt";
import { SqlResultBlock, parseSqlResult } from "@/app/components/SqlResultBlock";
// eslint-disable  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82VG0xMlNnPT06MzgwNDRmZDg=

interface ArgItemProps {
  argKey: string;
  value: any;
  isExpanded?: boolean;
  onToggle: (key: string) => void;
}
// FIXME  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82VG0xMlNnPT06MzgwNDRmZDg=

const ArgItem = memo<ArgItemProps>(({ argKey, value, isExpanded, onToggle }) => {
  const serializedValue = useMemo(() => {
    if (!isExpanded) return "";
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [isExpanded, value]);

  return (
    <div className="rounded-sm border border-border">
      <button
        onClick={() => onToggle(argKey)}
        className="flex w-full items-center justify-between bg-muted/30 p-2 text-left text-xs font-medium transition-colors hover:bg-muted/50"
      >
        <span className="font-mono">{argKey}</span>
        {isExpanded ? (
          <ChevronUp size={12} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={12} className="text-muted-foreground" />
        )}
      </button>
      {isExpanded && (
        <div className="border-t border-border bg-muted/20 p-2 max-h-96 overflow-y-auto">
          <pre className="m-0 overflow-x-auto whitespace-pre font-mono text-xs leading-6 text-foreground">
            {serializedValue}
          </pre>
        </div>
      )}
    </div>
  );
});

ArgItem.displayName = "ArgItem";
// NOTE  Mi80OmFIVnBZMlhrdUp2bG43bmx2TG82VG0xMlNnPT06MzgwNDRmZDg=

interface ToolCallBoxProps {
  toolCall: ToolCall;
  uiComponent?: any;
  stream?: any;
  graphId?: string;
  actionRequest?: ActionRequest;
  reviewConfig?: ReviewConfig;
  onResume?: (value: any) => void;
  isLoading?: boolean;
}

export const ToolCallBox = React.memo<ToolCallBoxProps>(
  ({
    toolCall,
    uiComponent,
    stream,
    graphId,
    actionRequest,
    reviewConfig,
    onResume,
    isLoading,
  }) => {
    if (toolCall.name === 'delegate') {
    console.log('[ToolCallBox-delegate] toolCall keys:', Object.keys(toolCall));
    console.log('[ToolCallBox-delegate] artifact:', (toolCall as any).artifact);
    console.log('[ToolCallBox-delegate] result type:', typeof (toolCall as any).result);
  }
  const [isExpanded, setIsExpanded] = useState(
      () => !!uiComponent || !!actionRequest
    );
    const [expandedArgs, setExpandedArgs] = useState<Record<string, boolean>>(
      {}
    );

    const { name, args, result, status } = useMemo(() => {
      return {
        name: toolCall.name || "Unknown Tool",
        args: toolCall.args || {},
        result: toolCall.result,
        status: toolCall.status || "completed",
      };
    }, [toolCall.name, toolCall.args, toolCall.result, toolCall.status, (toolCall as any).artifact]);

    const argsKeys = useMemo(() => Object.keys(args), [args]);
    const argsEntries = useMemo(() => Object.entries(args), [args]);
    const hasContent = useMemo(
      () => result || argsKeys.length > 0,
      [result, argsKeys.length]
    );

    const deferredResult = useDeferredValue(result);

    const serializedResult = useMemo(() => {
      if (!deferredResult) return "";
      if (typeof deferredResult === "string") {
        return deferredResult;
      }
      try {
        return JSON.stringify(deferredResult, null, 2);
      } catch {
        return String(deferredResult);
      }
    }, [deferredResult]);

    // P1-2：SQL 结果分类判定（表格卡/错误卡）。null = 无法分类 → 回退原 <pre>。
    const sqlParsed = useMemo(
      () => parseSqlResult(name, serializedResult, status),
      [name, serializedResult, status]
    );

    const toggleExpanded = useCallback(() => {
      setIsExpanded((prev) => !prev);
    }, []);

    const toggleArgExpanded = useCallback((argKey: string) => {
      setExpandedArgs((prev) => ({
        ...prev,
        [argKey]: !prev[argKey],
      }));
    }, []);

    const statusIcon = useMemo(() => {
      switch (status) {
        case "completed":
          return <CircleCheckBigIcon />;
        case "error":
          return (
            <AlertCircle
              size={14}
              className="text-destructive"
            />
          );
        case "pending":
          return (
            <Loader2
              size={14}
              className="animate-spin"
            />
          );
        case "interrupted":
          return (
            <StopCircle
              size={14}
              className="text-orange-500"
            />
          );
        default:
          return (
            <Terminal
              size={14}
              className="text-muted-foreground"
            />
          );
      }
    }, [status]);

    return (
      <div
        className={cn(
          "w-full overflow-hidden rounded-lg border-none shadow-none outline-none transition-colors duration-200 hover:bg-accent",
          isExpanded && hasContent && "bg-accent"
        )}
        style={{ contentVisibility: "auto", containIntrinsicSize: "100px" }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleExpanded}
          className={cn(
            "flex w-full items-center justify-between gap-2 border-none px-2 py-2 text-left shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-default"
          )}
          disabled={!hasContent}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {statusIcon}
              <span className="text-[15px] font-medium tracking-[-0.6px] text-foreground">
                {name}
              </span>
            </div>
            {hasContent &&
              (isExpanded ? (
                <ChevronUp
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
              ) : (
                <ChevronDown
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
              ))}
          </div>
        </Button>

        {isExpanded && hasContent && (
          <div className="px-4 pb-4">
            {uiComponent && stream && graphId ? (
              <div className="mt-4">
                <LoadExternalComponent
                  key={uiComponent.id}
                  stream={stream}
                  message={uiComponent}
                  namespace={graphId}
                  meta={{ status, args, result: result ?? "暂无结果" }}
                />
              </div>
            ) : actionRequest && onResume ? (
              // Show tool approval UI when there's an action request but no GenUI
              <div className="mt-4">
                <ToolApprovalInterrupt
                  actionRequest={actionRequest}
                  reviewConfig={reviewConfig}
                  onResume={onResume}
                  isLoading={isLoading}
                />
              </div>
            ) : (
              <>
                {argsKeys.length > 0 && (
                  <div className="mt-4">
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      输入 IN
                    </h4>
                    <div className="space-y-2">
                      {argsEntries.map(([key, value]) => (
                        <ArgItem
                          key={key}
                          argKey={key}
                          value={value}
                          isExpanded={expandedArgs[key]}
                          onToggle={toggleArgExpanded}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {(toolCall as any)?.artifact?.subagent_type && (toolCall as any)?.artifact?.steps && (
                  <div className="mt-4 rounded-sm border border-blue-200 bg-blue-50/50 p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
                      {(toolCall as any).artifact.subagent_type} 执行过程 ({(toolCall as any).artifact.total_steps} 步)
                    </h4>
                    <div className="space-y-1.5 max-h-80 overflow-y-auto">
                      {(toolCall as any).artifact.steps.map((step: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span className="mt-0.5 min-w-[1.5rem] text-center font-mono text-blue-500">
                            {step.step}
                          </span>
                          <span className="font-mono text-blue-400 min-w-[4rem]">
                            {step.type === "ai" ? "AI" : step.type === "tool_call" ? "TOOL" : step.type}
                          </span>
                          <span className="text-gray-600 break-all">
                            {step.type === "tool_call" ? `${step.name}(${step.args})` : step.content}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {result && (
                  <div className="mt-4">
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      输出 OUT
                    </h4>
                    {(() => {
                      // 图表工具：跳过 iframe 渲染，由 ChatMessage 在消息体统一展示，
                      // 避免同一图表在工具卡片 + 消息体重复出现。
                      const isChartTool = chartToolNames.some(
                        (n) => name === n || (name || "").includes(n)
                      );
                      if (isChartTool) {
                        return (
                          <div className="text-xs text-muted-foreground italic">
                            图表已渲染在消息中 ↑
                          </div>
                        );
                      }
                      // 非图表工具：只渲染「交互式」iframe（含 echarts.init / CDN），
                      // 丢弃静态 SVG iframe，避免同一图表出现可交互+静态两份。
                      if (typeof serializedResult === "string" && serializedResult.includes("<iframe")) {
                        const interactive = extractInteractiveChartIframes(serializedResult);
                        if (interactive.length > 0) {
                          return (
                            <div className="w-full" dangerouslySetInnerHTML={{ __html: interactive[0] }} />
                          );
                        }
                        // 无交互式 iframe（可能是静态 SVG）→ 回退到文本展示
                      }
                      // P1-2：SQL 结果分类渲染（表格卡/错误卡）；无法分类回退原 pre
                      if (sqlParsed) {
                        return (
                          <SqlResultBlock
                            toolName={name}
                            result={serializedResult}
                            status={status}
                          />
                        );
                      }
                      return (
                        <div className="max-h-96 overflow-y-auto rounded-sm border border-border bg-muted/40">
                          <pre className="m-0 overflow-x-auto whitespace-pre p-2 font-mono text-xs leading-7 text-foreground">
                            {serializedResult}
                          </pre>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }
);

ToolCallBox.displayName = "ToolCallBox";
// NOTE  My80OmFIVnBZMlhrdUp2bG43bmx2TG82VG0xMlNnPT06MzgwNDRmZDg=
