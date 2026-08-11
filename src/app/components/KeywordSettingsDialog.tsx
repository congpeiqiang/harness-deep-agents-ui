"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  getConfig,
  saveConfig,
  getQueryKeywords,
  DEFAULT_QUERY_KEYWORDS,
} from "@/lib/config";

interface KeywordSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 查询关键词设置弹窗。
 *
 * 关键词用于：
 * - 前端 isQueryMessage 判断"消息是否为数据查询"（查询进行中拦截）
 * - 后端 QueryKeywordsMiddleware 注入 LLM 系统提示词（委派判断）
 *
 * 存储于 localStorage（deep-agent-config.queryKeywords），
 * 与后端 prompt 默认一致；留空回退到默认关键词。
 */
export function KeywordSettingsDialog({
  open,
  onOpenChange,
}: KeywordSettingsDialogProps) {
  const [keywordsText, setKeywordsText] = useState("");

  useEffect(() => {
    if (open) {
      setKeywordsText(getQueryKeywords().join(", "));
    }
  }, [open]);

  const handleSave = () => {
    // 按逗号拆分并清理空白，过滤空项
    const parsed = keywordsText
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const config = getConfig();
    if (config) {
      saveConfig({
        ...config,
        queryKeywords: parsed.length > 0 ? parsed : undefined,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>查询关键词设置</DialogTitle>
          <DialogDescription>
            命中关键词的消息会被视为数据查询。查询进行中再次输入查询会被拦截提示。
            用逗号分隔多个关键词，留空则使用默认关键词。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="queryKeywords">查询关键词（逗号分隔）</Label>
            <Input
              id="queryKeywords"
              placeholder={DEFAULT_QUERY_KEYWORDS.join(", ")}
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              默认：{DEFAULT_QUERY_KEYWORDS.join("、")}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
