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
import { Switch } from "@/components/ui/switch";
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
 * 对话设置弹窗。
 *
 * 查询关键词用于：
 * - 前端 isQueryMessage 判断"消息是否为数据查询"（查询进行中拦截）
 * - 后端 QueryKeywordsMiddleware 注入 LLM 系统提示词（委派判断）
 *
 * "开启思考过程"开关前后端共用：开 → 后端真正开启模型思考（reasoning_content 流出、
 * 前端显示折叠块）；关 → 后端关闭思考（更快更省，前端自然不显示）。随 run 的
 * configurable.enable_thinking 传给后端 ThinkingToggleMiddleware。
 *
 * 存储于 localStorage（deep-agent-config），与后端 prompt 默认一致；留空回退到默认关键词。
 */
export function KeywordSettingsDialog({
  open,
  onOpenChange,
}: KeywordSettingsDialogProps) {
  const [keywordsText, setKeywordsText] = useState("");
  const [enableThinking, setEnableThinking] = useState(true);

  useEffect(() => {
    if (open) {
      setKeywordsText(getQueryKeywords().join(", "));
      try {
        setEnableThinking(getConfig()?.enableThinking ?? true);
      } catch {
        setEnableThinking(true);
      }
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
        enableThinking,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>对话设置</DialogTitle>
          <DialogDescription>
            配置数据查询关键词与 AI 回复的"深度思考"显示。
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
              命中关键词的消息会被识别为数据查询，自动委派给 NL2SQL 子智能体查询。
              未命中走普通对话。用逗号分隔多个关键词，留空则使用默认关键词：
              {DEFAULT_QUERY_KEYWORDS.join("、")}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div className="grid gap-1">
              <Label htmlFor="enableThinking">开启思考过程</Label>
              <p className="text-xs text-muted-foreground">
                开启：模型先生成"深度思考"再回答，前端展示可折叠的思考内容；
                关闭：模型直接回答，不思考、更快更省。
              </p>
            </div>
            <Switch
              id="enableThinking"
              checked={enableThinking}
              onCheckedChange={setEnableThinking}
            />
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
