"use client";
import Link from "next/link";
import Image from "next/image";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="ui-auth">
      <main className="ui-auth-card">
        <Link className="ws-brand" href="/">
          <Image
            src="/sma-icon.png"
            unoptimized
            width={34}
            height={34}
            alt=""
          />
          <strong>SMA Center</strong>
        </Link>
        <h1>页面暂时无法打开</h1>
        <p>请重试，或返回总览。</p>
        <button onClick={reset}>重试</button>
        <Link href="/">返回总览</Link>
      </main>
    </div>
  );
}
