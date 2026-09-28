/**
 * 部署 URL 的**唯一解析点**（2026-09-25）。
 *
 * 背景：`config.deploymentUrl` 是**每个用户存在自己浏览器里**的值（设置对话框里填），
 * 留空时旧代码在各处兜底成 `http://localhost:2026` —— 而 `:2026` 只绑回环（09-23 关两个
 * 旁路门之后的副作用），对**别人的浏览器**来说 `localhost` 是用户自己的机器 ⇒ 表现是
 * 页面能开、但「模型都没了 + Failed to fetch」。
 *
 * 现在的兜底是 `window.location.origin`：页面本身就是从 nginx 入口发下来的，
 * origin 天然等于「这台机器上能访问后端的那个入口」，无论用户从哪个 host 打开都对：
 * - 生产入口 `http://192.168.25.64/` → origin = 老实的 nginx 地址（旧的 `:2026` 直连已不通）
 * - 换域名/加端口/走 https（如 `http://192.168.25.13:2026` 直连后端）→ 自动跟随，不用改配置
 * - dev 环境 `:8080` → 同样成立
 *
 * ⇒ **留空是安全默认**（不是「没配好」）；填了就以填的为准（允许把前端指向别的后端）。
 *
 * ⚠️ 必须走这个函数，不要再在页面里写 `|| "http://localhost:2026"` 这类兜底 ——
 * 一处写错就等于把上面这些全绕过去。
 */
export function resolveDeploymentUrl(configured?: string | null): string {
  const trimmed = (configured ?? "").trim().replace(/\/+$/, "");
  if (trimmed) return trimmed;
  // SSR 阶段没有 window；调用点都在客户端组件里（fetch/useMemo），有 window 时才兜底
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
