import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts, type AlertState } from "../lib/alert-rules.ts";
test("alerts require five continuous minutes, use hysteresis, and do not recover from missing samples", () => {
  let state: AlertState = { failures: 0, high: {} };
  for (let now = 0; now < 300000; now += 30000) {
    const result = evaluateAlerts(state, { cpuPercent: 95 }, now);
    state = result.state;
    assert(!result.decisions.some((d) => d.kind === "cpuPercent"));
  }
  const triggered = evaluateAlerts(state, { cpuPercent: 95 }, 300000);
  assert(triggered.decisions.some((d) => d.kind === "cpuPercent" && d.active));
  assert(
    !evaluateAlerts(
      triggered.state,
      { cpuPercent: null },
      330000,
    ).decisions.some((d) => d.kind === "cpuPercent"),
  );
  assert(
    !evaluateAlerts(triggered.state, { cpuPercent: 87 }, 330000).decisions.some(
      (d) => d.kind === "cpuPercent",
    ),
  );
  assert(
    evaluateAlerts(triggered.state, { cpuPercent: 84 }, 330000).decisions.some(
      (d) => d.kind === "cpuPercent" && !d.active,
    ),
  );
  assert(
    !evaluateAlerts(state, { cpuPercent: 95 }, 600000).decisions.some(
      (d) => d.kind === "cpuPercent" && d.active,
    ),
  );
});
test("three consecutive failures trigger a connection event; success recovers it and resets the sequence", () => {
  let state: AlertState = { failures: 0, high: {} };
  for (const now of [0, 30000]) {
    const result = evaluateAlerts(state, null, now);
    state = result.state;
    assert.equal(result.decisions.length, 0);
  }
  const failed = evaluateAlerts(state, null, 60000);
  assert(failed.decisions.some((d) => d.active));
  const recovered = evaluateAlerts(failed.state, {}, 90000);
  assert.equal(recovered.state.failures, 0);
  assert(recovered.decisions.some((d) => d.kind === "connection" && !d.active));
  assert.equal(
    evaluateAlerts(recovered.state, null, 120000).decisions.length,
    0,
  );
});
