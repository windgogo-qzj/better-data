import type { Metadata } from "next";
import "./globals.css";
import "./landing-v3.css";

export const metadata: Metadata = {
  title: "Better Data · 本地数据预处理工作台",
  description: "在本机完成可解释、可调整、可复现的数据预处理与特征工程。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
