import { metricLabels, type MetricKey } from "./workspace-model.ts";
export type AlertState = {
  failures: number;
  high: Partial<Record<MetricKey, number>>;
  lastAt?: number;
  source?: string;
};
export type Decision = { kind: string; title: string; active: boolean };
export function evaluateAlerts(
  previous: AlertState,
  values: Partial<Record<MetricKey, number | null>> | null,
  now: number,
) {
  const state: AlertState = {
    ...previous,
    high: { ...previous.high },
    lastAt: now,
  };
  if (previous.lastAt !== undefined && now - previous.lastAt > 90_000) {
    state.failures = 0;
    state.high = {};
  }
  const decisions: Decision[] = [];
  if (!values) {
    state.failures++;
    state.high = {};
    if (state.failures >= 3)
      decisions.push({
        kind: "connection",
        title: "采集连接连续失败",
        active: true,
      });
    return { state, decisions };
  }
  state.failures = 0;
  decisions.push({ kind: "connection", title: "", active: false });
  for (const key of Object.keys(metricLabels) as MetricKey[]) {
    const value = values[key];
    if (value == null || !Number.isFinite(value)) {
      delete state.high[key];
      continue;
    }
    if (value >= 90) {
      state.high[key] ??= now;
      if (now - state.high[key]! >= 300_000)
        decisions.push({
          kind: key,
          title: `${metricLabels[key]}持续超过 90%`,
          active: true,
        });
    } else {
      delete state.high[key];
      if (value < 85) decisions.push({ kind: key, title: "", active: false });
    }
  }
  return { state, decisions };
}
