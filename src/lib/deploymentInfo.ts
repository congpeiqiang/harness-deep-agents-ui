/**
 * 部署默认配置的**唯一探测点**（2026-09-28）。
 *
 * 目的：新账号 / 新浏览器首次打开时，不要再让用户手填「部署 URL」和「助手 ID」。
 * 这两个值都由服务端给定，前端登录后自动写进本地配置（见 `app/components/ConfigBootstrap.tsx`）：
 *
 * - **部署 URL** → 存**空串**，即「跟随当前访问地址」（语义见 `lib/deploymentUrl.ts`）。
 *   刻意不写死 origin：页面从哪个入口发下来就用哪个，换域名/端口/https 都不用改配置。
 * - **助手 ID** → 来自 `GET /api/deployment-info`（后端从仓库根 `langgraph.json`
 *   的 `graphs` 里读；主入口 `chat_agent`）。
 *
 * 服务端要求登录（该路径不在 auth 白名单）⇒ 调用点必须在 `AuthGuard` **之内**，
 * 否则必然 401（这正是这次把首屏配置门挪到登录之后的原因）。
 *
 * 任何失败都返回 `null`（不抛）：调用方据此回落到手动配置弹窗，
 * 绝不能因为探测不通就把人挡在门外。
 */
export interface DeploymentInfo {
  /** 默认可用的「助手 ID」——图名（如 `chat_agent`），不必是 assistant 的 UUID。 */
  assistantId: string;
  /** 本部署注册的图名列表（诊断用）。 */
  graphIds: string[];
  /** `langgraph.json` = 读到了；`fallback` = 后端回落常量。 */
  source: string;
}

/** 探测部署默认配置。失败/未登录/后端无此端点 → `null`。 */
export async function fetchDeploymentInfo(): Promise<DeploymentInfo | null> {
  try {
    // 相对路径 = 同源（nginx 把 /api 反代到后端）。刻意不用 resolveDeploymentUrl：
    // 此刻还没有配置，而这条请求本身就该打到「发下这个页面的那个入口」。
    const res = await fetch("/api/deployment-info", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[deployment-info] 探测失败 HTTP ${res.status}，回退手动配置`);
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const assistantId =
      typeof data.assistant_id === "string" ? data.assistant_id.trim() : "";
    if (!assistantId) {
      console.warn("[deployment-info] 响应缺 assistant_id，回退手动配置");
      return null;
    }
    return {
      assistantId,
      graphIds: Array.isArray(data.graph_ids) ? data.graph_ids.map(String) : [],
      source: typeof data.source === "string" ? data.source : "",
    };
  } catch (e) {
    console.warn("[deployment-info] 探测异常，回退手动配置:", e);
    return null;
  }
}
