// 交互式图表 iframe 识别与提取（echarts data:text/html;base64 自包含 iframe）。
// 多组件共用：ChatMessage 正文渲染、ToolCallBox 工具结果渲染、ChatInterface 附随图表。

/** 只保留「交互式」图表 iframe：HTML 含 echarts.init / CDN，丢弃静态 SVG iframe。 */
export function isInteractiveChartIframe(html: string): boolean {
  const m = html.match(/data:text\/html;base64,([A-Za-z0-9+/=]+)/);
  if (!m) return false;
  try {
    const decoded = decodeURIComponent(escape(atob(m[1])));
    // 交互式：含 echarts.init 或 echarts CDN script；静态 SVG 不含
    return /echarts\.init|cdn\.jsdelivr\.net|unpkg\.com/.test(decoded);
  } catch {
    return false;
  }
}

/** 从文本中提取所有「交互式」图表 iframe 的 HTML 字符串。 */
export function extractInteractiveChartIframes(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const iframeRegex = /<iframe[^>]*>[^<]*<\/iframe>/g;
  return (text.match(iframeRegex) || [])
    .map(String)
    .filter(isInteractiveChartIframe);
}

/** 生成图表（echarts 等）的工具名集合，用于判断工具调用结果是否为图表。 */
export const chartToolNames = [
  "generate_echarts",
  "generate-echarts",
  "render_chart",
  "renderChart",
  "chart",
];
