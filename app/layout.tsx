import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMA Center",
  description: "资源、指标与事件面板。",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/apple-touch-icon.png",
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
