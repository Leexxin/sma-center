"use client";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

export default function CollectionStatus({ label, className, errors }: {
  label: string;
  className?: string;
  errors?: { collector: string; code: string }[];
}) {
  if (!errors?.length) return <span className={className}>{label}</span>;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`collection-status ${className || ""}`}
            aria-label={`${label}，查看采集详情`}
          >
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8} className="collection-details">
          <strong>采集异常详情</strong>
          {errors.map((error, index) => (
            <p key={index}>
              {error.collector || "未知采集器"} · {error.code || "未知错误"}
            </p>
          ))}
          <p>异常采集器的指标可能不可用，其他有效指标仍会显示。</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
