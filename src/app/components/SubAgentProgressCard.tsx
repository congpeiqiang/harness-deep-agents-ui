"use client";

import React from "react";
import { Loader2, CircleCheck, Circle, AlertCircle } from "lucide-react";
import type { TodoItem } from "@/app/types/types";

// ── 类型定义 ──────────────────────────────────────────────────

export interface SubAgentProgress {
  taskId: string;
  agentName: string;
  /** 用户提问的问题标题，用于关联卡片与输入区问题 */
  queryTitle?: string;
  status: "running" | "success" | "error";
  /** 查询阶段（子智能体步骤） */
  todos: TodoItem[];
  /** 结果阶段（图表/报告） */
  resultTodos?: TodoItem[];
  elapsed: string;
  latestThinking: string | null;
}

// ── 步骤图标 ──────────────────────────────────────────────────

function StepIcon({ status }: { status: TodoItem["status"] }) {
  switch (status) {
    case "completed":
      return <CircleCheck size={14} className="shrink-0 text-green-500" />;
    case "in_progress":
      return (
        <Loader2 size={14} className="shrink-0 animate-spin text-blue-500" />
      );
    default:
      return <Circle size={14} className="shrink-0 text-gray-300" />;
  }
}

// ── 进度条（子智能体 + 结果阶段合计） ─────────────────────────

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/30">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="min-w-[3rem] text-right text-xs text-gray-500">
        {pct}%
      </span>
    </div>
  );
}

// ── 分组标签 ──────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs font-medium text-gray-400 dark:text-gray-500">
      <span className="h-px w-3 bg-blue-200 dark:bg-blue-900/60" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-blue-200 dark:bg-blue-900/60" />
    </div>
  );
}

// ── 步骤列表 ──────────────────────────────────────────────────

function StepList({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="space-y-1">
      {todos.map((todo, i) => (
        <div
          key={todo.id || i}
          className={`flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
            todo.status === "in_progress" ? "bg-blue-100/50 dark:bg-blue-900/20" : ""
          }`}
        >
          <StepIcon status={todo.status} />
          <span
            className={`flex-1 ${
              todo.status === "completed"
                ? "text-gray-500 line-through"
                : todo.status === "in_progress"
                ? "font-medium text-blue-700 dark:text-blue-400"
                : "text-gray-400"
            }`}
          >
            {todo.content}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────

interface SubAgentProgressCardProps {
  progress: SubAgentProgress;
  /** 全宽展示（输入区合并使用）；默认 max-w-[85%] 留给消息流 */
  fullWidth?: boolean;
  /** 折叠态：只显示问题标题 + 标题行，隐藏进度条与步骤列表 */
  collapsed?: boolean;
  /** 点击卡片标题区切换折叠（输入区交互） */
  onToggle?: () => void;
  /** 点击「停止」取消该任务（输入区交互） */
  onCancel?: () => void;
  /** 取消请求进行中（按钮变「取消中...」并禁用） */
  cancelling?: boolean;
}

export const SubAgentProgressCard = React.memo<SubAgentProgressCardProps>(
  ({ progress, fullWidth, collapsed, onToggle, onCancel, cancelling }) => {
    const isRunning = progress.status === "running";
    const isError = progress.status === "error";
    const allTodos = [...(progress.todos || []), ...(progress.resultTodos || [])];
    const hasSteps = allTodos.length > 0;
    const completed = allTodos.filter((s) => s.status === "completed").length;
    const showResult = (progress.resultTodos?.length ?? 0) > 0;

    // 头部左侧：状态图标 + 名称 + 状态（折叠命中区 = 外层 wrapper，见 return）
    const headerLeft = (
      <div className="flex min-w-0 items-center gap-2">
        {isRunning && (
          <Loader2 size={16} className="shrink-0 animate-spin text-blue-500" />
        )}
        {isError && <AlertCircle size={16} className="shrink-0 text-red-500" />}
        {!isRunning && !isError && (
          <CircleCheck size={16} className="shrink-0 text-green-500" />
        )}
        <span className="shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
          {progress.agentName}
        </span>
        <span className="shrink-0 text-xs text-gray-400">
          {isRunning ? "执行中" : isError ? "出错" : "已完成"}
        </span>
      </div>
    );

    // 头部右侧：步骤数 + 耗时 + 停止按钮 + 折叠箭头
    const headerRight = (
      <div className="flex shrink-0 items-center gap-2 text-xs text-gray-400">
        {hasSteps && <span>{completed}/{allTodos.length} 步</span>}
        <span>⏱ {progress.elapsed}</span>
        {isRunning && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            data-stop-btn
            className="shrink-0 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/40 dark:hover:bg-red-950/70"
            title="停止该查询"
          >
            {cancelling ? "取消中..." : "⏹ 停止"}
          </button>
        )}
        {onToggle && (
          <span className="shrink-0" title={collapsed ? "展开" : "折叠"}>
            {collapsed ? "▸" : "▾"}
          </span>
        )}
      </div>
    );

    // 头部整行（静态展示；折叠命中区由外层可点击 wrapper 提供，见 return）
    const header = (
      <div className="mb-2 flex items-center justify-between gap-2">
        {headerLeft}
        {headerRight}
      </div>
    );

    return (
      <div
        className={`${
          fullWidth ? "my-1 w-full" : "my-3 w-full max-w-[85%]"
        } overflow-hidden rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50/80 to-white px-4 py-3 shadow-sm dark:border-blue-800 dark:from-blue-950/40 dark:to-background`}
      >
        {/* 折叠命中区：问题标题 + 头部整行整块可点击，方便把执行中的卡片收成一行 */}
        <div
          className={onToggle ? "cursor-pointer select-none" : ""}
          onClick={
            onToggle
              ? (e) => {
                  // 点「停止」按钮不触发折叠（data-stop-btn 标记兜底）
                  if ((e.target as HTMLElement).closest("[data-stop-btn]")) return;
                  onToggle();
                }
              : undefined
          }
          title={onToggle ? (collapsed ? "点击展开" : "点击折叠") : undefined}
        >
          {/* 问题标题（关联输入区提问） */}
          {progress.queryTitle && (
            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <span className="shrink-0">📌</span>
              <span className="truncate">{progress.queryTitle}</span>
            </div>
          )}

          {header}
        </div>

        {/* 进度条：仅展开态显示；折叠后靠标题行的 X/Y 步 + 耗时呈现进度 */}
        {hasSteps && !collapsed && (
          <div className="mb-2">
            <ProgressBar completed={completed} total={allTodos.length} />
          </div>
        )}

        {/* 折叠态：到此为止 */}
        {!collapsed && (
          <>
            {/* 查询阶段（子智能体步骤） */}
            {progress.todos.length > 0 && (
              <>
                {showResult && <SectionLabel label="查询阶段" />}
                <StepList todos={progress.todos} />
              </>
            )}

            {/* 结果阶段（图表/报告） */}
            {showResult && (
              <>
                <SectionLabel label="结果阶段" />
                <StepList todos={progress.resultTodos!} />
              </>
            )}

            {/* 无步骤时的初始状态 */}
            {!hasSteps && isRunning && (
              <div className="flex items-center gap-2 py-1 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" />
                正在初始化...
              </div>
            )}

            {/* AI 最新思考 */}
            {isRunning && progress.latestThinking && (
              <div className="mt-2 border-t border-blue-100 pt-2 dark:border-blue-900/50">
                <p className="text-xs italic text-gray-400 line-clamp-2">
                  💭 {progress.latestThinking}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    );
  }
);

SubAgentProgressCard.displayName = "SubAgentProgressCard";
