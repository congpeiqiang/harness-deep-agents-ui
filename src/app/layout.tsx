import localFont from "next/font/local";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import "./globals.css";
import type { Metadata } from "next";
// @ts-expect-error  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82VjIxeVRRPT06NjNkMmFkZDk=

export const metadata: Metadata = {
  title: "Weint Harness",
  icons: { icon: "/weint.svg" },
};

// 自托管 Inter（latin 子集，可变字重 100-900），字形与 `Inter({ subsets: ["latin"] })` 一致。
// 不用 next/font/google：它在**构建期**去 fonts.googleapis.com 抓字体文件，本机/内网
// 环境可达性时通时断 → `yarn build` 随机失败（"Failed to fetch `Inter` from Google Fonts"）。
// 换 next/font/local 后构建与运行都不再依赖外网，产物仍由 Next 内联进 .next/static/media。
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  adjustFontFallback: "Arial",
});
// NOTE  MS8yOmFIVnBZMlhrdUp2bG43bmx2TG82VjIxeVRRPT06NjNkMmFkZDk=

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
    >
      <body
        className={inter.className}
        suppressHydrationWarning
      >
        <NuqsAdapter>{children}</NuqsAdapter>
        <Toaster />
      </body>
    </html>
  );
}
