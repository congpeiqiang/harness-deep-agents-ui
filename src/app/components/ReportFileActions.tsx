"use client";
// 报告文件预览/下载 —— 识别 AI 消息里的报告路径（/workspace/report/*.md 或
// 磁盘路径形态 D:/.../report/*.md），渲染 预览/下载 按钮。
// 后端 API：GET /api/reports/{filename}（预览） / ?download=1（附件下载）
//           HEAD /api/reports/{filename}（存在性探测，见下）
//
// 存在性探测：模型会在正文里手写文件路径，写错就是「点了才 404」的假附件
// （2026-09-14 实例：图表真名 `…_165606.html`，模型写成 `…_165623`，三个附件
// 只有第一个能下载）。所以渲染按钮前先 HEAD 探一次：**只有 404 才当作不存在**
// ——405（旧后端无 HEAD）/ 5xx / 网络错误一律按「可能存在」处理（fail-open），
// 新前端配旧后端不会把真附件藏起来。

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Eye, Download, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileViewDialog } from "@/app/components/FileViewDialog";
import type { FileItem } from "@/app/types/types";
import { getConfig } from "@/lib/config";

// NOTE  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82TlRSWlVnPT06ZThlOGVkYTQ=

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

/**
 * 提取文本中的报告文件名。
 * 锚点是 `/report/<文件名>`：VFS 形态 `/workspace/report/xxx.md` 与
 * VfsPathResolverMiddleware 改写后的磁盘形态 `D:/.../report/xxx.md` 都包含该段。
 * 文件名允许空格（如「1990 年代电影平均评分_20260824_153013.html」），用非贪婪
 * 匹配 + 扩展名结尾 + 终止符（空白/中英文标点/结束）界定，避免吞掉后续文字。
 *
 * 文件名字符类里**不能**排除中文标点（2026-09-17 实例：报告标题
 * 「按项目集比较需求交付率、缺陷解决率与工时投入」生成的文件名含顿号，被旧正则
 * 的排除集挡住 → 整个文件名匹配失败 → 附件按钮连同「引用文件不存在」提示一起
 * 静默消失）。后端生成文件名时只清洗 `\ / : * ? " < > |` 与换行
 * （report_builder.py 的 _SAFE_FNAME），中文标点原样保留，所以这里只排除结构
 * 字符即可；非贪婪 + 扩展名锚定已保证「结果.md、以及…」这类 prose 只取 `结果.md`。
 * 残留的极少数误判由下面的 HEAD 探测兜住（隐藏 + 提示），不会变成假按钮。
 */
// 方括号写成 `\]{}[` 的顺序：类内 `[` 无需转义（写 `\[` 会触发 no-useless-escape），
// 但裸 `[` 若紧跟 `]` 会提前闭合字符类，故用 `{}` 隔开。
const REPORT_FILE_RE =
  /report\/([^/\\\n\r\t\]{}[<>"'`|]+?\.(?:md|markdown|html|htm|txt|json|csv))(?:[\s,，。；;:：!！?？*\]{}[<>"'`、|（）()]|$)/g;

function extractReportFilenames(text: string): string[] {
  if (!text || !/report\//.test(text)) return [];
  const found: string[] = [];
  let m: RegExpExecArray | null;
  REPORT_FILE_RE.lastIndex = 0;
  while ((m = REPORT_FILE_RE.exec(text)) !== null) {
    const name = m[1];
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

// ── 存在性探测 ──────────────────────────────────────────────────────
// 命中（存在）永久缓存；不存在带 TTL——文件可能是稍晚才落盘的，不能永久隐藏。
const NOT_FOUND_TTL_MS = 15_000;
const existsCache = new Map<string, { exists: boolean; at: number }>();

/** 读缓存：未命中或否定结论已过期 → undefined（需重新探测）。 */
function readCache(name: string): boolean | undefined {
  const c = existsCache.get(name);
  if (!c) return undefined;
  if (!c.exists && Date.now() - c.at >= NOT_FOUND_TTL_MS) return undefined;
  return c.exists;
}

/** HEAD 探测报告文件是否存在；仅 404 判否，其余按「存在」兜底。 */
async function probeExists(name: string): Promise<boolean> {
  const hit = readCache(name);
  if (hit !== undefined) return hit;
  try {
    const res = await fetch(
      `${apiBase()}/api/reports/${encodeURIComponent(name)}`,
      { method: "HEAD", cache: "no-store" }
    );
    const exists = res.status !== 404;
    existsCache.set(name, { exists, at: Date.now() });
    return exists;
  } catch {
    return true; // 网络异常无法判定 → 照常给按钮（fail-open）
  }
}

export const ReportFileActions = React.memo<{ content: string }>(
  ({ content }) => {
    const files = useMemo(() => extractReportFilenames(content), [content]);
    const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
    const [loadingName, setLoadingName] = useState<string | null>(null);
    // 探测结果（与模块级缓存合并后使用）
    const [probed, setProbed] = useState<Record<string, boolean>>({});

    // 文件名指纹：流式输出每 token 都会重算 files，探测只能按「文件名集合」触发，
    // 否则每个 token 都打一轮 HEAD。
    const filesKey = files.join("|");

    useEffect(() => {
      const names = filesKey ? filesKey.split("|") : [];
      const todo = names.filter((n) => readCache(n) === undefined);
      if (todo.length === 0) return;
      let cancelled = false;
      void Promise.all(
        todo.map(async (n) => [n, await probeExists(n)] as const)
      ).then((pairs) => {
        if (cancelled) return;
        setProbed((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
      });
      return () => {
        cancelled = true;
      };
    }, [filesKey]);

    // 缓存命中（刷新页面/重放历史消息）不再打探测请求
    const known = useMemo(() => {
      const m: Record<string, boolean> = {};
      for (const n of files) {
        const c = readCache(n);
        if (c !== undefined) m[n] = c;
      }
      return { ...m, ...probed };
    }, [files, probed]);

    const handlePreview = useCallback(async (name: string) => {
      setLoadingName(name);
      try {
        const res = await fetch(
          `${apiBase()}/api/reports/${encodeURIComponent(name)}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        setSelectedFile({ path: name, content: text });
      } catch (e) {
        toast.error(`预览报告失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoadingName(null);
      }
    }, []);

    const handleDownload = useCallback((name: string) => {
      // 直接指向后端 ?download=1，走 RFC5987 Content-Disposition（中文文件名不乱码）
      const a = document.createElement("a");
      a.href = `${apiBase()}/api/reports/${encodeURIComponent(name)}?download=1`;
      a.target = "_blank";
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, []);

    if (files.length === 0) return null;

    // 只渲染已确认存在的文件；确认不存在的隐藏并给一行提示（否则会变成
    // 「点了才 404」的假附件）；尚未探测完的暂时不渲染，避免按钮闪现后消失。
    const visible = files.filter((n) => known[n] === true);
    const missing = files.filter((n) => known[n] === false);
    if (visible.length === 0 && missing.length === 0) return null;

    return (
      <>
        <div className="mt-3 flex flex-col gap-2">
          {visible.map((name) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              style={{ backgroundColor: "var(--color-file-button)" }}
            >
              <FileText size={16} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => handlePreview(name)}
                disabled={loadingName !== null}
              >
                {loadingName === name ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <Eye size={14} className="mr-1" />
                )}
                预览
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => handleDownload(name)}
              >
                <Download size={14} className="mr-1" />
                下载
              </Button>
            </div>
          ))}
          {missing.length > 0 && (
            <div
              className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground"
              title={missing.join("\n")}
            >
              <AlertTriangle size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {missing.length} 个引用文件不存在，已隐藏（模型给出的路径可能已过期）
              </span>
            </div>
          )}
        </div>
        {selectedFile && (
          <FileViewDialog
            file={selectedFile}
            onSaveFile={async () => {
              throw new Error("报告为只读预览");
            }}
            onClose={() => setSelectedFile(null)}
            editDisabled
          />
        )}
      </>
    );
  }
);

// eslint-disable  My80OmFIVnBZMlhrdUp2bG43bmx2TG82TlRSWlVnPT06ZThlOGVkYTQ=

ReportFileActions.displayName = "ReportFileActions";
