"use client";

// 消息反馈操作行（P1-1，对标 deepseek-harness dsh-message-feedback）。
// 👍/👎 + 可选备注；乐观更新父级 feedbackMap，失败回滚；version CAS 防并发覆盖。
//
// 2026-08-27 合并提交：新增反馈（当前无记录）点 👍/👎 时不再立即发「空备注」的
// PUT——展开备注框进入 pending，保存备注（rating+note 一次提交）/ 收起 / 移开焦点
// 才落库。避免 Langfuse Scores 出现「空备注中间行」，一条反馈 = 一条 score。
import React, { useEffect, useRef, useState } from "react";
import { ThumbsUp, ThumbsDown, MessageSquareText, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  deleteFeedback,
  putFeedback,
  type FeedbackRating,
  type FeedbackRecord,
} from "@/lib/feedback";

interface MessageFeedbackActionsProps {
  threadId: string;
  messageId: string;
  /** 当前已有反馈（父级 feedbackMap 回显），null/undefined = 未反馈 */
  feedback?: FeedbackRecord | null;
  /** 当前选中库名：首次保存时快照进 context（评测回流归因用） */
  dbContext?: string;
  disabled?: boolean;
  /** 父级更新 feedbackMap 的回调（乐观更新） */
  onChange: (messageId: string, feedback: FeedbackRecord | null) => void;
  /** P1-5：附加在操作行尾部的其它动作（如「从此处分叉」按钮），与反馈按钮同行 */
  extraActions?: React.ReactNode;
  /** 复制内容（AI 回答正文）；提供则渲染「复制」按钮于点赞左侧 */
  copyText?: string;
  /** 消息级耗时：TTFT（首 token 时间，ms）*/
  ttftMs?: number;
  /** 消息级耗时：总用时（ms）*/
  durationMs?: number;
  /** 该轮 token 维度（后端 steps[].round_index 按轮聚合） */
  roundStat?: RoundStat;
}

export interface RoundStat {
  llmMs: number;
  input: number;
  output: number;
  cacheRead: number;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

function fmtTok(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function MessageFeedbackActions({
  threadId,
  messageId,
  feedback,
  dbContext,
  disabled,
  onChange,
  extraActions,
  copyText,
  ttftMs,
  durationMs,
  roundStat,
}: MessageFeedbackActionsProps) {
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const current = feedback ?? null;

  const optimistic = (rating: FeedbackRating, note: string): FeedbackRecord => ({
    thread_id: threadId,
    message_id: messageId,
    rating,
    note,
    version: (current?.version ?? 0) + 1,
    created_at: current?.created_at ?? "",
    updated_at: "",
    context: current?.context,
  });

  // pending：新反馈点 👍/👎 后尚未落库的评分（等待备注决策或失焦）。
  // 避免两步保存（先空备注 PUT、再备注 PUT）在 Langfuse 产生「空备注中间行」。
  const [pending, setPending] = useState<FeedbackRating | null>(null);
  const pendingRef = useRef<FeedbackRating | null>(null);
  const noteDraftRef = useRef("");
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    noteDraftRef.current = noteDraft;
  }, [noteDraft]);

  // 卸载兜底：pending 未提交的评分在组件卸载前尽力落库（fire-and-forget）
  useEffect(() => {
    return () => {
      const rating = pendingRef.current;
      if (rating) {
        void putFeedback(threadId, messageId, {
          rating,
          note: noteDraftRef.current.trim(),
          context: { db_name: dbContext ?? "" },
        }).catch(() => {
          /* 组件已卸载，尽力而为 */
        });
      }
    };
  }, [threadId, messageId, dbContext]);

  // 提交 pending 的评分（带备注或空备注），作为「新反馈」的首次写入。
  const commitPending = async (note: string) => {
    if (!pending || busy) return;
    const rating = pending;
    setPending(null);
    setBusy(true);
    setNoteOpen(false);
    try {
      const saved = await putFeedback(threadId, messageId, {
        rating,
        note,
        context: { db_name: dbContext ?? "" },
      });
      onChange(messageId, saved);
    } catch (e) {
      onChange(messageId, null); // 乐观回滚（无服务器记录）
      const status = (e as { status?: number })?.status;
      toast.error(
        status === 409
          ? "反馈已被其他操作更新，请重试"
          : `保存反馈失败：${e instanceof Error ? e.message : e}`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRating = async (rating: FeedbackRating) => {
    if (busy || disabled) return;
    // 再次点击已选中的评价 → 撤销
    if (current?.rating === rating) {
      if (pending) {
        // 未提交的新反馈被取消：回退 UI，无需调 DELETE（服务器无记录）
        setPending(null);
        setNoteOpen(false);
        onChange(messageId, null);
        return;
      }
      const prev = current;
      setBusy(true);
      onChange(messageId, null);
      try {
        await deleteFeedback(threadId, messageId, prev.version);
      } catch (e) {
        onChange(messageId, prev); // 回滚
        toast.error(`撤销反馈失败：${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    // 已有 pending → 切换评分（仍未提交，只改本地乐观态）
    if (pending) {
      setPending(rating);
      onChange(messageId, optimistic(rating, ""));
      return;
    }
    // 新反馈（无服务器记录）：延迟提交——展开备注框，保存备注/收起/失焦才落库
    if (!current) {
      setNoteDraft("");
      setNoteOpen(true);
      setPending(rating);
      onChange(messageId, optimistic(rating, ""));
      return;
    }
    // 已有反馈：切换评分，立即提交（保留已有 note）
    const prev = current;
    const next = optimistic(rating, current.note ?? "");
    setBusy(true);
    onChange(messageId, next);
    try {
      const saved = await putFeedback(threadId, messageId, {
        rating,
        note: current.note ?? "",
        if_version: current.version,
      });
      onChange(messageId, saved);
    } catch (e) {
      onChange(messageId, prev); // 回滚
      const status = (e as { status?: number })?.status;
      toast.error(
        status === 409
          ? "反馈已被其他操作更新，请重试"
          : `保存反馈失败：${e instanceof Error ? e.message : e}`
      );
    } finally {
      setBusy(false);
    }
  };

  const openNote = () => {
    setNoteDraft(current?.note ?? "");
    setNoteOpen((v) => !v);
  };

  // 复制回答正文（clipboard API + execCommand 兜底）
  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      toast.success("已复制");
      return;
    } catch {
      /* 非安全上下文 / 剪贴板权限不足 → 走 execCommand 兜底 */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = copyText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const saveNote = async () => {
    if (busy || !current) return;
    const note = noteDraft.trim();
    if (pending) {
      // 新反馈：备注与评分一次提交（rating+note 单条 score）
      await commitPending(note);
      return;
    }
    const prev = current;
    const next = optimistic(current.rating, note);
    setBusy(true);
    onChange(messageId, next);
    try {
      const saved = await putFeedback(threadId, messageId, {
        rating: current.rating,
        note,
        if_version: current.version,
      });
      onChange(messageId, saved);
      setNoteOpen(false);
      toast.success("备注已保存");
    } catch (e) {
      onChange(messageId, prev);
      const status = (e as { status?: number })?.status;
      toast.error(
        status === 409
          ? "反馈已被其他操作更新，请重试"
          : `保存备注失败：${e instanceof Error ? e.message : e}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-1"
      onBlur={(e) => {
        // 焦点离开整个反馈行 → 提交 pending 的评分（防止点👍后一直不落库）
        if (!pending || busy) return;
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return; // 焦点仍在行内
        void commitPending(noteDraft.trim());
      }}
    >
      <div className="group flex items-center gap-0.5">
        {copyText && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={handleCopy}
            disabled={disabled}
            aria-label="复制回答"
            title="复制回答"
          >
            <Copy size={14} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 text-muted-foreground",
            current?.rating === "positive" && "text-success"
          )}
          onClick={() => handleRating("positive")}
          disabled={busy || disabled}
          aria-label="回答有帮助"
        >
          <ThumbsUp size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 text-muted-foreground",
            current?.rating === "negative" && "text-destructive"
          )}
          onClick={() => handleRating("negative")}
          disabled={busy || disabled}
          aria-label="回答有问题"
        >
          <ThumbsDown size={14} />
        </Button>
        {current && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 text-muted-foreground",
              current.note && "text-foreground"
            )}
            onClick={openNote}
            disabled={busy || disabled}
            aria-label="补充备注"
          >
            <MessageSquareText size={14} />
          </Button>
        )}
        {current?.note && !noteOpen && (
          <span className="text-muted-foreground ml-1 max-w-[320px] truncate text-xs">
            {current.note}
          </span>
        )}
        {extraActions}
        {/* 消息级 timing：与反馈按钮同一行，鼠标移到该行才显示（hover-to-show）。
            TTFT（首 token 用时）+ 总用时；缺失则不渲染。 */}
        {(ttftMs != null || durationMs != null || roundStat) && (
          <span className="ml-1 select-none whitespace-nowrap text-[11px] text-muted-foreground/80 opacity-0 transition-opacity group-hover:opacity-100">
            {ttftMs != null && `首 token ${(ttftMs / 1000).toFixed(1)}s`}
            {ttftMs != null && (durationMs != null || roundStat) && " · "}
            {durationMs != null && `用时 ${(durationMs / 1000).toFixed(1)}s`}
            {durationMs != null && roundStat && " · "}
            {roundStat && `LLM ${fmtMs(roundStat.llmMs)}`}
            {roundStat && roundStat.llmMs > 0 &&
              ` · ${Math.round(roundStat.output / (roundStat.llmMs / 1000))} tok/s`}
            {roundStat && roundStat.cacheRead > 0 &&
              ` · 缓存命中 ${Math.round((roundStat.cacheRead / roundStat.input) * 100)}%`}
            {roundStat && ` · 输入 ${fmtTok(roundStat.input)} tok · 输出 ${fmtTok(roundStat.output)} tok`}
          </span>
        )}
      </div>
      {noteOpen && current && (
        <div className="mt-2 flex w-full max-w-md flex-col gap-2">
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder={
              current.rating === "positive"
                ? "可选：写下哪里帮助到了你（会用于改进系统）"
                : "可选：写下哪里不满意（会用于改进系统）"
            }
            rows={2}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={saveNote} disabled={busy}>
              保存备注
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // 收起备注框：pending 未提交则落库（无备注），已提交则仅关闭
                if (pending) {
                  void commitPending("");
                  return;
                }
                setNoteOpen(false);
              }}
              disabled={busy}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
