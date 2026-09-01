"use client";
// 报告文件预览/下载 —— 识别 AI 消息里的报告路径（/workspace/report/*.md 或
// 磁盘路径形态 D:/.../report/*.md），渲染 预览/下载 按钮。
// 后端 API：GET /api/reports/{filename}（预览） / ?download=1（附件下载）。

import React, { useCallback, useMemo, useState } from "react";
import { FileText, Eye, Download, Loader2 } from "lucide-react";
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
 */
const REPORT_FILE_RE =
  /report\/([^/\\\n,，。；;:：!！?？\[\]{}<>"'`、|]+?\.(?:md|markdown|html|htm|txt|json|csv))(?:[\s,，。；;:：!！?？\[\]{}<>"'`、|（）()]|$)/g;

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

export const ReportFileActions = React.memo<{ content: string }>(
  ({ content }) => {
    const files = useMemo(() => extractReportFilenames(content), [content]);
    const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
    const [loadingName, setLoadingName] = useState<string | null>(null);

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

    return (
      <>
        <div className="mt-3 flex flex-col gap-2">
          {files.map((name) => (
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
