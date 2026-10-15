import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "sma-center · 个人工具站",
  description: "由验证器动态码保护的个人工具、站点与服务器导航工作台。",
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
