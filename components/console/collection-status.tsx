"use client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
export default function CollectionStatus({ label, className, errors, tone }: {
  label: string;
  className?: string;
  tone?: string;
  errors?: { collector: string; code: string }[];
}) {
  const color = tone === "warning" || errors?.length ? "warning" : tone === "good" ? "good" : "neutral";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={`collection-status status-indicator status-${color} ${className || ""}`} aria-label={`${label}，查看采集详情`}>
            <span className="status-dot" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8} className="collection-details">
          <strong>{label}</strong>
          {errors?.map((error, index) => <p key={index}>{error.collector || "未知采集器"} · {error.code || "未知错误"}</p>)}
          {!!errors?.length && <p>异常采集器的指标可能不可用，其他有效指标仍会显示。</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
