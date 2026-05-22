import { Inter } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import "./globals.css";
// @ts-expect-error  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82VjIxeVRRPT06NjNkMmFkZDk=

const inter = Inter({ subsets: ["latin"] });
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
