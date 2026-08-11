// 用 playwright 加载目标 URL，抓取控制台/网络/截图，判断"一直加载中"的根因
const { chromium } = require("playwright");
const URL = "http://localhost:3000/?assistantId=chat_agent&sidebar=1&threadId=019fda6e-3b86-78e3-b6e9-cb67699e3370";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleMsgs = [];
  const pageErrors = [];
  const networkFail = [];
  page.on("console", (m) => consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 500)));
  page.on("requestfailed", (r) => networkFail.push(`${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(6000);
  } catch (e) {
    pageErrors.push("goto error: " + String(e).slice(0, 300));
  }

  // 抓页面文本，找"加载/初始化/错误"
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1500) : "NO BODY");
  // 截图
  await page.screenshot({ path: "_inspect.png", fullPage: false });

  console.log("=== PAGE ERRORS ===");
  console.log(pageErrors.join("\n") || "(none)");
  console.log("=== CONSOLE (first 25) ===");
  console.log(consoleMsgs.slice(0, 25).join("\n") || "(none)");
  console.log("=== NETWORK FAILURES ===");
  console.log(networkFail.slice(0, 15).join("\n") || "(none)");
  console.log("=== BODY TEXT (first 1500) ===");
  console.log(bodyText);

  await browser.close();
})();
