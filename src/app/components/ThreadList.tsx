"use client";
// NOTE  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82WTA5TGJnPT06ZjkwZTdlNTc=

import {
  startTransition,
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import { format } from "date-fns";
import { Loader2, MessageSquare, X, Trash2, Square, CheckSquare, Pencil, Check, GitFork, Search, Plus, ListChecks, PanelLeftClose } from "lucide-react";
import { useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ThreadItem } from "@/app/hooks/useThreads";
import { useThreads } from "@/app/hooks/useThreads";
import { useClient } from "@/providers/ClientProvider";
import { setThreadTitle } from "@/lib/threadMeta";
import { forkThread } from "@/lib/threadFork";
import { searchThreads, type ThreadSearchResult } from "@/lib/threadSearch";

type StatusFilter = "all" | "idle" | "busy" | "interrupted" | "error";

const GROUP_LABELS = {
  interrupted: "需要关注",
  today: "今天",
  yesterday: "昨天",
  week: "本周",
  older: "更早",
} as const;
// NOTE  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82WTA5TGJnPT06ZjkwZTdlNTc=

const STATUS_COLORS: Record<ThreadItem["status"], string> = {
  idle: "bg-green-500",
  busy: "bg-blue-500",
  interrupted: "bg-orange-500",
  error: "bg-red-600",
};

function getThreadColor(status: ThreadItem["status"]): string {
  return STATUS_COLORS[status] ?? "bg-gray-400";
}

function formatTime(date: Date, now = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return format(date, "HH:mm");
  if (days === 1) return "昨天";
  if (days < 7) return format(date, "EEEE");
  return format(date, "MM/dd");
}

function StatusFilterItem({
  status,
  label,
  badge,
}: {
  status: ThreadItem["status"];
  label: string;
  badge?: number;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "inline-block size-2 rounded-full",
          getThreadColor(status)
        )}
      />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold leading-none text-white">
          {badge}
        </span>
      )}
    </span>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <p className="text-sm text-red-600">加载对话列表失败</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
// TODO  Mi80OmFIVnBZMlhrdUp2bG43bmx2TG82WTA5TGJnPT06ZjkwZTdlNTc=

function LoadingState() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-16 w-full"
        />
      ))}
    </div>
  );
}
// @ts-expect-error  My80OmFIVnBZMlhrdUp2bG43bmx2TG82WTA5TGJnPT06ZjkwZTdlNTc=

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <MessageSquare className="mb-2 h-12 w-12 text-gray-300" />
      <p className="text-sm text-muted-foreground">暂无对话</p>
    </div>
  );
}

interface ThreadListProps {
  onThreadSelect: (id: string) => void;
  onMutateReady?: (mutate: () => void) => void;
  onClose?: () => void;
  onInterruptCountChange?: (count: number) => void;
  /** 搜索输入框是否展开（默认收起为图标） */
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  /** 批量管理模式（默认收起为图标） */
  batchMode?: boolean;
  onBatchModeChange?: (mode: boolean) => void;
}

export function ThreadList({
  onThreadSelect,
  onMutateReady,
  onClose,
  onInterruptCountChange,
  searchOpen = false,
  onSearchOpenChange,
  batchMode = false,
  onBatchModeChange,
}: ThreadListProps) {
  const [currentThreadId, setCurrentThreadId] = useQueryState("threadId");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  // P1-5 分叉：正在整线程复制的会话 ID
  const [forkingThreadId, setForkingThreadId] = useState<string | null>(null);
  const [selectedThreads, setSelectedThreads] = useState<Set<string>>(new Set());
  // P1-4 重命名：正在编辑的会话 + 草稿值
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  // P1-6 会话全文搜索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ThreadSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const client = useClient();

  const searchActive = searchQuery.trim() !== "";

  // 搜索防抖（300ms）；清空则回到普通列表
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        setSearchResults(await searchThreads(q));
      } catch (e) {
        console.error("Thread search failed:", e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const threads = useThreads({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 20,
  });

  const flattened = useMemo(() => {
    return threads.data?.flat() ?? [];
  }, [threads.data]);

  const isLoadingMore =
    threads.size > 0 && threads.data?.[threads.size - 1] == null;
  const isEmpty = threads.data?.at(0)?.length === 0;
  const isReachingEnd = isEmpty || (threads.data?.at(-1)?.length ?? 0) < 20;

  // Group threads by time and status
  const grouped = useMemo(() => {
    const now = new Date();
    const groups: Record<keyof typeof GROUP_LABELS, ThreadItem[]> = {
      interrupted: [],
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };

    flattened.forEach((thread) => {
      if (thread.status === "interrupted") {
        groups.interrupted.push(thread);
        return;
      }

      const diff = now.getTime() - thread.updatedAt.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) {
        groups.today.push(thread);
      } else if (days === 1) {
        groups.yesterday.push(thread);
      } else if (days < 7) {
        groups.week.push(thread);
      } else {
        groups.older.push(thread);
      }
    });

    return groups;
  }, [flattened]);

  const interruptedCount = useMemo(() => {
    return flattened.filter((t) => t.status === "interrupted").length;
  }, [flattened]);

  // Expose thread list revalidation to parent component
  // Use refs to create a stable callback that always calls the latest mutate function
  const onMutateReadyRef = useRef(onMutateReady);
  const mutateRef = useRef(threads.mutate);
  const mutateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onMutateReadyRef.current = onMutateReady;
  }, [onMutateReady]);

  useEffect(() => {
    mutateRef.current = threads.mutate;
  }, [threads.mutate]);

  useEffect(() => {
    return () => {
      if (mutateTimerRef.current !== null) {
        window.clearTimeout(mutateTimerRef.current);
      }
    };
  }, []);

  


  const mutateFn = useCallback(() => {
    if (typeof window === "undefined") {
      startTransition(() => {
        mutateRef.current();
      });
      return;
    }

    if (mutateTimerRef.current !== null) {
      window.clearTimeout(mutateTimerRef.current);
    }

    mutateTimerRef.current = window.setTimeout(() => {
      startTransition(() => {
        mutateRef.current();
      });
      mutateTimerRef.current = null;
    }, 80);
  }, []);
const toggleThread = useCallback((threadId: string) => {
    setSelectedThreads(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId); else next.add(threadId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const allIds = flattened.map(t => t.id);
    setSelectedThreads(prev => {
      const allSelected = allIds.length > 0 && allIds.every(id => prev.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  }, [threads.data]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedThreads.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedThreads.size} 条对话吗？`)) return;
    if (currentThreadId && selectedThreads.has(currentThreadId)) setCurrentThreadId(null);
    try {
      const results = await Promise.allSettled(
        Array.from(selectedThreads).map(id => client.threads.delete(id))
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      mutateFn();
      setSelectedThreads(new Set());
      onBatchModeChange?.(false);
      if (failed > 0) alert(`${failed} 条删除失败，其余已删除`);
    } catch (e) {
      console.error("Batch delete failed:", e);
      alert("批量删除失败");
    }
  }, [selectedThreads, client, currentThreadId, setCurrentThreadId, mutateFn, onBatchModeChange]);


  useEffect(() => {
    onMutateReadyRef.current?.(mutateFn);
    // Only run once on mount to avoid infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // P1-4：自动标题写入后立即刷新列表（ChatInterface 写标题成功后派发）
  useEffect(() => {
    const onTitleUpdated = () => mutateFn();
    window.addEventListener("thread-title-updated", onTitleUpdated);
    return () => window.removeEventListener("thread-title-updated", onTitleUpdated);
  }, [mutateFn]);

  const handleDeleteThread = useCallback(
    async (threadId: string, e: React.MouseEvent) => {
      e.stopPropagation();

      if (!confirm("确定要删除这条对话吗？此操作无法撤销。")) {
        return;
      }

      setDeletingThreadId(threadId);
      // 先断开当前流
      if (currentThreadId === threadId) {
        setCurrentThreadId(null);
      }
      try {
        await client.threads.delete(threadId);

        mutateFn();
      } catch (error) {
        console.error("Failed to delete thread:", error);
        alert("删除失败，请重试。");
      } finally {
        setDeletingThreadId(null);
      }
    },
    [client, currentThreadId, setCurrentThreadId, threads]
  );

  // P1-5 会话分叉：整线程复制（不带锚点），成功后刷新列表并切换到新会话
  const handleForkThread = useCallback(
    async (threadId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (batchMode || forkingThreadId) return;
      setForkingThreadId(threadId);
      try {
        const res = await forkThread(threadId);
        mutateFn();
        await onThreadSelect(res.thread_id);
      } catch (error) {
        console.error("Failed to fork thread:", error);
        alert("分叉失败，请重试。");
      } finally {
        setForkingThreadId(null);
      }
    },
    [batchMode, forkingThreadId, mutateFn, onThreadSelect]
  );

  // Notify parent of interrupt count changes
  useEffect(() => {
    onInterruptCountChange?.(interruptedCount);
  }, [interruptedCount, onInterruptCountChange]);

  // ── P1-4 重命名 ──────────────────────────────────────────
  const startRename = useCallback(
    (thread: ThreadItem, e: React.MouseEvent) => {
      e.stopPropagation();
      if (batchMode) return;
      setRenamingThreadId(thread.id);
      // 已有自定义标题则编辑它，否则置空让用户全新输入
      setRenameDraft(thread.hasCustomTitle ? thread.title : "");
    },
    [batchMode]
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    setRenameDraft("");
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingThreadId || savingRename) return;
    const title = renameDraft.trim();
    setSavingRename(true);
    try {
      if (title) {
        await setThreadTitle(client, renamingThreadId, title);
      }
      mutateFn();
    } catch (error) {
      console.error("Failed to rename thread:", error);
      alert("重命名失败，请重试。");
    } finally {
      setSavingRename(false);
      setRenamingThreadId(null);
      setRenameDraft("");
    }
  }, [renamingThreadId, renameDraft, savingRename, client, mutateFn]);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header: 状态筛选 + 搜索/批量 + 收起侧边栏（无标题，对标 deepseek harness 极简侧边栏） */}
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger className="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">所有状态</SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>活跃</SelectLabel>
              <SelectItem value="idle">
                <StatusFilterItem
                  status="idle"
                  label="空闲"
                />
              </SelectItem>
              <SelectItem value="busy">
                <StatusFilterItem
                  status="busy"
                  label="忙碌"
                />
              </SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>需要关注</SelectLabel>
              <SelectItem value="interrupted">
                <StatusFilterItem
                  status="interrupted"
                  label="已中断"
                  badge={interruptedCount}
                />
              </SelectItem>
              <SelectItem value="error">
                <StatusFilterItem
                  status="error"
                  label="错误"
                />
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground",
              searchOpen && "bg-accent text-foreground"
            )}
            onClick={() => onSearchOpenChange?.(!searchOpen)}
            aria-label="搜索历史对话"
            title="搜索历史对话"
          >
            <Search className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground",
              batchMode && "bg-accent text-foreground"
            )}
            onClick={() => onBatchModeChange?.(!batchMode)}
            aria-label="批量管理"
            title="批量管理"
          >
            <ListChecks className="size-5" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="size-10 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="收起侧边栏"
              title="收起侧边栏"
            >
              <PanelLeftClose className="size-5" />
            </Button>
          )}
        </div>
      </div>

      {/* 新建会话（对标 deepseek harness New Session：加号图标 + 文案，实心底色按钮） */}
      <div className="flex flex-shrink-0 gap-2 border-b border-border p-3">
        <Button
          variant="ghost"
          className="h-10 w-full justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
          onClick={() => setCurrentThreadId(null)}
        >
          <Plus className="size-4" />
          新建会话
        </Button>
      </div>

      {/* P1-6 搜索输入框（点击搜索图标展开） */}
      {searchOpen && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索历史对话内容…"
            className="h-8 flex-1 border-none px-0 shadow-none focus-visible:ring-0"
          />
          {searchActive && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="清空搜索"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* 批量管理工具栏（点击批量图标展开） */}
      {batchMode && !searchActive && (
        <div className="flex flex-shrink-0 items-center gap-2 px-3 py-2 border-b">
          <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
            {flattened.length > 0 && selectedThreads.size === flattened.length ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            <span className="ml-1 text-xs">全选</span>
          </Button>
          <span className="text-xs text-muted-foreground">{selectedThreads.size}/{flattened.length}</span>
          <div className="flex-1" />
          <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={selectedThreads.size === 0}>删除选中</Button>
          <Button variant="ghost" size="sm" onClick={() => { onBatchModeChange?.(false); setSelectedThreads(new Set()); }}>取消</Button>
        </div>
      )}
      <ScrollArea className="h-0 flex-1">
        {searchActive && (
          <div className="p-2">
            {searching && (
              <p className="px-3 py-2 text-xs text-muted-foreground">搜索中…</p>
            )}
            {!searching && searchResults !== null && searchResults.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">无匹配会话</p>
            )}
            {searchResults?.map((r) => (
              <button
                key={r.thread_id}
                type="button"
                onClick={() => onThreadSelect(r.thread_id)}
                className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <div className="mb-0.5 flex items-center justify-between">
                  <h3 className="truncate text-sm font-semibold">
                    {r.title || "（无标题会话）"}
                  </h3>
                  {r.matched_count > 1 && (
                    <span className="ml-2 flex-shrink-0 text-xs text-muted-foreground">
                      {r.matched_count} 处
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {r.snippet}
                </p>
              </button>
            ))}
          </div>
        )}

        {!searchActive && threads.error && <ErrorState message={threads.error.message} />}

        {!searchActive && !threads.error && !threads.data && threads.isLoading && (
          <LoadingState />
        )}

        {!searchActive && !threads.error && !threads.isLoading && isEmpty && <EmptyState />}

        {!searchActive && !threads.error && !isEmpty && (
          <div className="box-border w-full max-w-full overflow-hidden p-2">
            {(
              Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>
            ).map((group) => {
              const groupThreads = grouped[group];
              if (groupThreads.length === 0) return null;

              return (
                <div
                  key={group}
                  className="mb-4"
                >
                  <h4 className="m-0 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABELS[group]}
                  </h4>
                  <div className="flex flex-col gap-1">
                    {groupThreads.map((thread) => (
                      <div
                        key={thread.id}
                        className="group relative flex items-start gap-1"
                      >
                        {batchMode && (
                          <button
                            type="button"
                            onClick={() => toggleThread(thread.id)}
                            className="mt-2 ml-1 flex-shrink-0"
                          >
                            {selectedThreads.has(thread.id) ? (
                              <CheckSquare className="h-4 w-4 text-blue-500" />
                            ) : (
                              <Square className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        )}
                        {/* Delete button - positioned at description line, outside the text */}
                        <button
                          type="button"
                          onClick={(e) => { if (batchMode) return; handleDeleteThread(thread.id, e); }}
                          disabled={deletingThreadId === thread.id}
                          className={cn(
                            "absolute left-0 bottom-3 z-10 flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100",
                            deletingThreadId === thread.id && "opacity-100"
                          )}
                          title="删除对话"
                        >
                          {deletingThreadId === thread.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {/* P1-4 重命名按钮（外置绝对定位，避免按钮嵌套） */}
                        {renamingThreadId !== thread.id && (
                          <button
                            type="button"
                            onClick={(e) => startRename(thread, e)}
                            className={cn(
                              "absolute left-6 bottom-3 z-10 flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                            )}
                            title="重命名对话"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* P1-5 分叉按钮：复制整个对话到新会话 */}
                        {renamingThreadId !== thread.id && (
                          <button
                            type="button"
                            onClick={(e) => { if (batchMode) return; handleForkThread(thread.id, e); }}
                            disabled={forkingThreadId === thread.id}
                            className={cn(
                              "absolute left-12 bottom-3 z-10 flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100",
                              forkingThreadId === thread.id && "opacity-100"
                            )}
                            title="分叉会话（复制整个对话到新会话）"
                          >
                            {forkingThreadId === thread.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <GitFork className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}

                        {renamingThreadId === thread.id ? (
                          /* P1-4 重命名编辑行（替换常规行，避免 input 嵌进 button） */
                          <div className="w-full rounded-lg border border-primary bg-accent px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              {savingRename ? (
                                <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
                              ) : (
                                <input
                                  autoFocus
                                  value={renameDraft}
                                  maxLength={50}
                                  placeholder="输入会话标题"
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      commitRename();
                                    } else if (e.key === "Escape") {
                                      cancelRename();
                                    }
                                  }}
                                  onBlur={commitRename}
                                  className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                                />
                              )}
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  commitRename();
                                }}
                                className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                title="保存"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  cancelRename();
                                }}
                                className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                title="取消"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onThreadSelect(thread.id)}
                            className={cn(
                              "grid w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors duration-200",
                              "hover:bg-accent",
                              currentThreadId === thread.id
                                ? "border-l-[3px] border-l-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.15)] hover:bg-[hsl(var(--primary)/0.2)]"
                                : "border-l-[3px] border-l-transparent bg-transparent"
                            )}
                            aria-current={currentThreadId === thread.id}
                          >
                            <div className="min-w-0 flex-1">
                              {/* Title + Timestamp Row */}
                              <div className="mb-1 flex items-center justify-between">
                                <h3 className="truncate text-sm font-semibold">
                                  {thread.title}
                                </h3>
                                <span className="ml-2 flex-shrink-0 text-xs text-muted-foreground">
                                  {formatTime(thread.updatedAt)}
                                </span>
                              </div>
                              {/* Description + Status Row */}
                              <div className="flex items-center justify-between">
                                <p className="flex-1 truncate text-sm text-muted-foreground">
                                  {thread.description}
                                </p>
                                <div className="ml-2 flex-shrink-0">
                                  <div
                                    className={cn(
                                      "h-2 w-2 rounded-full",
                                      getThreadColor(thread.status)
                                    )}
                                  />
                                </div>
                              </div>
                            </div>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {!isReachingEnd && (
              <div className="flex justify-center py-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => threads.setSize(threads.size + 1)}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      加载中...
                    </>
                  ) : (
                    "加载更多"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
