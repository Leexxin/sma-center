import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "sma-center · 个人工具站",
  description: "一个可自定义、支持多用户隔离的工具、站点与服务器导航控制台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
