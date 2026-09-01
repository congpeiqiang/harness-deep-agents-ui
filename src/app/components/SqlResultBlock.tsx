"use client";

// SQL 结果分类渲染（P1-2，对标 deepseek-harness ui-primitives/*Block 的按工具意图分类渲染）。
// run_sql / dbmcp_run_sql / wrenai_*_run_sql 的结果：
//   - 结构化 {columns, rows, row_count} → 数据表格卡（列头 + 行数）
//   - 错误（status=error 或错误文本）     → 错误卡（首行高亮 + 错误分类）
// 无法识别时返回 null，由调用方回退到原 <pre> 展示。
import React, { useMemo } from "react";
import { AlertCircle, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** 解析后的表格结果 */
interface ParsedTable {
  kind: "table";
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  statementCount?: number;
}

/** 解析后的错误结果 */
interface ParsedError {
  kind: "error";
  message: string;
  category: string;
}

type ParsedResult = ParsedTable | ParsedError | null;

const SQL_TOOL_RE = /run_sql|runsql|query_sql|execute_sql/i;

/** 错误分类 → 中文标签（对齐子 agent 纠错链路的话术）。 */
function classifyError(message: string): string {
  if (/syntax|parse|unexpected|near\s|unexpected token/i.test(message)) return "SQL 语法错误";
  if (/unknown column|unknown table|doesn'?t exist|no such (column|table)|column not found|invalid column|table not found/i.test(message)) return "表/列不存在";
  if (/denied|permission|access|forbidden|authentication/i.test(message)) return "权限/连接错误";
  if (/timeout|timed out|deadline/i.test(message)) return "执行超时";
  if (/limit|too many|exceed/i.test(message)) return "结果集过大";
  return "执行错误";
}

/** 尝试从（可能被包裹的）结果字符串里解析出 JSON 对象。 */
function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  // 直接 JSON
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === "object") return v as Record<string, unknown>;
  } catch {
    /* 继续尝试提取 */
  }
  // 可能被前后文本包裹：提取第一个 { 到最后一个 } 的子串
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const v = JSON.parse(trimmed.slice(start, end + 1));
      if (v && typeof v === "object") return v as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function parseSqlResult(toolName: string, result: unknown, status: string): ParsedResult {
  if (result == null) return null;
  const text = typeof result === "string" ? result : "";

  // 错误优先：status=error 或结果体含错误字段/错误特征
  if (status === "error") {
    const message = text || "执行失败";
    return { kind: "error", message, category: classifyError(message) };
  }

  const obj = tryParseJson(text);
  if (obj) {
    // 后端错误对象 {error: "..."} / {detail: "..."}
    if (typeof obj.error === "string" && obj.error) {
      return { kind: "error", message: obj.error, category: classifyError(obj.error) };
    }
    // 结构化表结果 {columns, rows, row_count}
    if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
      return {
        kind: "table",
        columns: obj.columns.map(String),
        rows: obj.rows as Record<string, unknown>[],
        rowCount: typeof obj.row_count === "number" ? obj.row_count : (obj.rows as unknown[]).length,
        statementCount: typeof obj.statement_count === "number" ? obj.statement_count : undefined,
      };
    }
  }

  // 非 JSON 但错误特征明显（仅当是 SQL 工具时才归为错误卡，避免误伤普通文本）
  if (SQL_TOOL_RE.test(toolName) && /\b(error|exception|failed|失败)\b/i.test(text) && text.length < 2000) {
    return { kind: "error", message: text, category: classifyError(text) };
  }

  return null;
}

/** 单元格值格式化：null/undefined → NULL（弱化），对象 → JSON。 */
function formatCell(v: unknown): { text: string; isNull: boolean } {
  if (v === null || v === undefined) return { text: "NULL", isNull: true };
  if (typeof v === "object") {
    try {
      return { text: JSON.stringify(v), isNull: false };
    } catch {
      return { text: String(v), isNull: false };
    }
  }
  return { text: String(v), isNull: false };
}

interface SqlResultBlockProps {
  toolName: string;
  result: unknown;
  status: string;
}

/** 返回 null 表示无法分类渲染，调用方应回退到原 <pre>。 */
export function SqlResultBlock({ toolName, result, status }: SqlResultBlockProps) {
  const parsed = useMemo(
    () => parseSqlResult(toolName, result, status),
    [toolName, result, status]
  );

  if (!parsed) return null;

  if (parsed.kind === "error") {
    const firstLine = parsed.message.split("\n").find((l) => l.trim()) ?? parsed.message;
    const rest = parsed.message
      .split("\n")
      .slice(parsed.message.split("\n").indexOf(firstLine) + 1)
      .join("\n")
      .trim();
    return (
      <div className="rounded-sm border border-destructive/40 bg-destructive/10">
        <div className="flex items-center gap-2 border-b border-destructive/20 px-3 py-2">
          <AlertCircle size={14} className="shrink-0 text-destructive" />
          <span className="text-xs font-semibold text-destructive">{parsed.category}</span>
        </div>
        <div className="max-h-64 overflow-y-auto p-3">
          <p className="m-0 break-words font-mono text-xs leading-6 text-destructive">{firstLine}</p>
          {rest && (
            <pre className="mt-2 m-0 overflow-x-auto whitespace-pre font-mono text-xs leading-6 text-muted-foreground">
              {rest}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // table
  const { columns, rows, rowCount, statementCount } = parsed;
  return (
    <div className="overflow-hidden rounded-sm border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
        <Table2 size={14} className="text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {rowCount} 行 × {columns.length} 列
          {statementCount && statementCount > 1 ? ` · ${statementCount} 条语句` : ""}
        </span>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted">
              {columns.map((c, i) => (
                <th
                  key={`${c}-${i}`}
                  className="whitespace-nowrap border-b border-r border-border px-2 py-1.5 text-left font-mono font-semibold text-foreground last:border-r-0"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={cn(ri % 2 === 1 && "bg-muted/20")}>
                {columns.map((c, ci) => {
                  const { text: cellText, isNull } = formatCell(row[c]);
                  return (
                    <td
                      key={`${c}-${ci}`}
                      className={cn(
                        "max-w-[320px] truncate border-b border-r border-border px-2 py-1 font-mono last:border-r-0",
                        isNull ? "italic text-muted-foreground/60" : "text-foreground"
                      )}
                      title={cellText}
                    >
                      {cellText}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length || 1}
                  className="px-2 py-3 text-center italic text-muted-foreground"
                >
                  （无数据）
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
