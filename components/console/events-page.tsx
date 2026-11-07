"use client";
import { useEffect,useState } from "react";
import Link from "next/link";
import ConsoleShell from "./shell";
import { consoleRequest } from "./resource-manager";
import type { ConsoleContext } from "@/lib/console-context";
type Event={id:string;resourceId:string;resourceName:string;title:string;startedAt:number;recoveredAt:number|null;acknowledgedAt:number|null;mutedUntil:number|null};
export default function EventsPage({context}:{context:ConsoleContext}){
 const [events,setEvents]=useState<Event[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState<string|null>(null);
 useEffect(()=>{let active=true;const load=async()=>{try{const r=await consoleRequest<{events:Event[]}>("/api/observability");if(active){setEvents(r.events);setError("");}}catch{if(active)setError("事件暂时无法读取，请稍后重试。");}finally{if(active)setLoading(false);}};void load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);};},[]);
 async function action(id:string,action:string){setBusy(id);try{await consoleRequest("/api/observability","PATCH",{id,action});setEvents((await consoleRequest<{events:Event[]}>("/api/observability")).events);setError("");}catch{setError("事件操作失败，请重试。");}finally{setBusy(null);}}
 return <ConsoleShell context={context} current="events" breadcrumb="事件"><header className="ui-page-heading"><div><h1>事件</h1><p>采集连接连续失败 3 次，或指标超过 90% 持续 5 分钟时记录事件。</p></div></header><section className="ui-panel events-page">
 {error&&<p role="alert" className="ui-warning">{error}</p>}
 {!error&&!events.length&&<p className="ws-empty">{loading?"正在读取…":"暂无事件"}</p>}
 <div className="ws-events">{events.map(e=><article className="ws-event" key={e.id}><span className={`ws-dot ${e.recoveredAt?"good":"warning"}`}/><div><Link href={`/servers/${e.resourceId}`}>{e.title}</Link><small>{e.resourceName} · {new Date(e.startedAt).toLocaleString("zh-CN")}</small><div className="ws-event-actions"><span>{e.recoveredAt?"已恢复":e.acknowledgedAt?"已确认":"待处理"}</span>{!e.acknowledgedAt&&<button disabled={busy===e.id} onClick={()=>void action(e.id,"acknowledge")}>确认</button>}{!e.recoveredAt&&<button disabled={busy===e.id} onClick={()=>void action(e.id,e.mutedUntil&&e.mutedUntil>Date.now()?"unmute":"mute")}>{e.mutedUntil&&e.mutedUntil>Date.now()?"取消静默":"静默 1 小时"}</button>}</div></div></article>)}</div></section></ConsoleShell>;
}
