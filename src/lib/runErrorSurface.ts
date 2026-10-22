"use client";

/**
 * run 创建失败的可视化兜底（2026-10-22）。
 *
 * 背景（线上实证）：`POST /threads/{tid}/runs/stream` 被后端 4xx 拒掉时，前端
 * **一声不吭**。那次是 422 `Invalid assistant: ''`（浏览器本地配置里的助手 ID
 * 是空串），用户点「发送」后界面纹丝不动，看起来就是「会话没响应」——
 * 排查只能 ssh 上去翻后端日志才看得到那行 422。
 *
 * 做法：在全局 `fetch` 上挂一个**只观察、不改写**的钩子。命中「run 创建类」
 * 请求且响应 ≥400 时，把后端 `detail` 弹成 toast。
 *
 * 三条自我约束（别为了报错把主流程弄坏）：
 * 1. 只在错误响应上 `clone()`（JSON，几十字节）；**200 的流式响应一个字节都不碰**
 *    —— /runs/stream 是 SSE，读错一次就是「回复永远不出来」。
 * 2. 同一句错误 5 秒内只弹一次：useStream 断流后会自动重试，否则 toast 刷屏。
 * 3. 观测逻辑自身任何异常都吞掉，绝不影响请求返回。
 */

import { toast } from "sonner";

/**
 * 判定「这次请求是不是在创建 run / 会话」。
 * 按路径精确匹配——不能用「前缀是 /threads 就算」：`POST /threads/search`、
 * `POST /threads/{id}/state` 都是 POST，全都会被误报成「消息发送失败」。
 */
function isRunCreate(url: string): boolean {
  const path = url.split("?")[0].replace(/^[a-z]+:\/\/[^/]+/i, "");
  return (
    path === "/threads" ||
    path === "/runs" ||
    path === "/runs/stream" ||
    path === "/runs/wait" ||
    path === "/runs/batch" ||
    /^\/threads\/[^/]+\/runs(\/(stream|wait|batch))?$/.test(path)
  );
}

/** 把后端错误体翻译成用户能照着做的一句话。 */
function describe(status: number, raw: string): string {
  let detail = "";
  try {
    const j = JSON.parse(raw) as { detail?: unknown; error?: unknown };
    if (typeof j?.detail === "string") detail = j.detail;
    else if (j?.detail) detail = JSON.stringify(j.detail);
    else if (typeof j?.error === "string") detail = j.error;
  } catch {
    detail = raw.slice(0, 200);
  }

  if (status === 401) return "登录已过期，请刷新页面重新登录后再发送。";
  if (status === 403) return detail || "请求被拒绝（403）：当前账号无权执行该操作。";
  if (status === 422 && /Invalid assistant/i.test(detail)) {
    // 与 page.tsx 的空助手 ID 自愈配套：自愈成功就不会走到这里，走到说明探测也失败了。
    return "助手 ID 未初始化（服务端探测失败）。请刷新页面重新初始化；仍不行请到「设置 → 部署 URL和助手 ID」核对，或联系管理员。";
  }
  return `HTTP ${status}${detail ? `：${detail.slice(0, 300)}` : ""}`;
}

let installed = false;
let lastKey = "";
let lastAt = 0;

/** 幂等安装；重复调用无副作用。由 ClientProvider 在挂载时调一次。 */
export function installRunErrorSurface(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await origFetch(input, init);
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ??
        (typeof input === "object" && "method" in input ? input.method : "GET")
      ).toUpperCase();

      if (method === "POST" && res.status >= 400 && isRunCreate(url)) {
        const msg = describe(res.status, await res.clone().text());
        const key = `${res.status}|${msg}`;
        const now = Date.now();
        if (key !== lastKey || now - lastAt > 5000) {
          lastKey = key;
          lastAt = now;
          toast.error("消息发送失败", { description: msg, duration: 8000 });
        }
      }
    } catch {
      /* 观测失败一律忽略：报错链路不许反过来打断主流程 */
    }
    return res;
  };
}
