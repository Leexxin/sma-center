import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSnapshot, metrics, cpuPercent } from "../lib/sma-metrics.ts";
import { SmaMonitor } from "../lib/sma-monitor.ts";

function raw(step = 0) {
  return {
    schemaVersion: "v1", agentVersion: "v0.2.8", timestamp: new Date(1_790_000_000_000 + step * 30_000).toISOString(),
    host: { hostname: "node", os: "linux", architecture: "amd64", systemMountpoint: "/", unsupportedMetrics: [] as string[] },
    cpu: { logicalCount: 1, seconds: { total: { user: 20 + step * 4, idle: 70 + step * 24, iowait: 10 + step * 2 } } },
    memory: { totalBytes: 100, availableBytes: 40, cachedBytes: 0 },
    filesystems: [{ device: "data", mountpoint: "/data", sizeBytes: 200, availableBytes: 0, freeBytes: 100 }, { device: "root", mountpoint: "/", sizeBytes: 100, availableBytes: 25, freeBytes: 50 }],
    disks: [{ device: "vda", readBytes: 100 + step * 300, writtenBytes: 200 + step * 600, readsCompleted: 10 + step * 30, writesCompleted: 20 + step * 60, ioInProgress: 0 }],
    load: { load1: 0, load5: 1, load15: 2 }, uptimeSeconds: 100 + step * 30, bootTimeSeconds: 123,
    errors: [] as Array<{ collector: string; code: string; message?: string }>,
  };
}
test("SMA rates require two valid samples, count iowait as busy, and match the system mount", () => {
  const a = normalizeSnapshot(raw()), b = normalizeSnapshot(raw(1));
  assert.equal(metrics(a).cpuPercent, null);
  assert.equal(metrics(a).diskRates[0].readBytesPerS, null);
  const m = metrics(b, a);
  assert.ok(Math.abs(m.cpuPercent! - 20) < 0.001);
  assert.equal(m.memoryPercent, 60);
  assert.equal(m.systemDiskPercent, 75);
  assert.deepEqual(m.diskRates[0], { device: "vda", readBytesPerS: 10, writeBytesPerS: 20, readIOPS: 1, writeIOPS: 2 });
  b.filesystems = b.filesystems.slice(0, 1);
  assert.equal(metrics(b).systemDiskPercent, null);
});
test("CPU rejects time, keys, core count, counters, reboot, source and upgrade changes", () => {
  const previous = normalizeSnapshot(raw());
  const mutations = [
    (s: ReturnType<typeof raw>) => { s.timestamp = previous.timestamp; },
    (s: ReturnType<typeof raw>) => { s.cpu.logicalCount = 2; },
    (s: ReturnType<typeof raw>) => { s.cpu.seconds.total.idle = 1; },
    (s: ReturnType<typeof raw>) => { s.cpu.seconds = { cpu0: s.cpu.seconds.total } as unknown as typeof s.cpu.seconds; },
    (s: ReturnType<typeof raw>) => { s.cpu.seconds.total = { user: 50, idle: 90, nice: 2 } as unknown as typeof s.cpu.seconds.total; },
    (s: ReturnType<typeof raw>) => { s.host.hostname = "other"; },
    (s: ReturnType<typeof raw>) => { s.bootTimeSeconds++; },
    (s: ReturnType<typeof raw>) => { s.uptimeSeconds = 1; },
    (s: ReturnType<typeof raw>) => { s.agentVersion = "v0.2.9"; },
    (s: ReturnType<typeof raw>) => { s.cpu.seconds.total.user = NaN; },
  ];
  for (const mutate of mutations) { const next = raw(1); mutate(next); assert.equal(cpuPercent(previous, normalizeSnapshot(next)), null); }
  assert.equal(cpuPercent(previous, previous), null);
});
test("Windows placeholders, absent objects, invalid numbers and partial errors never become measured zero", () => {
  const next = raw(1); next.host.os = "windows"; next.host.systemMountpoint = "C:\\";
  next.filesystems[1].mountpoint = "C:\\";
  next.host.unsupportedMetrics = ["memory.cachedBytes", "load"];
  let s = normalizeSnapshot(next);
  assert.equal(s.load, null); assert.equal(s.memory?.cachedBytes, undefined); assert.equal(metrics(s).systemDiskPercent, 75);
  assert.equal(normalizeSnapshot({ ...next, cpu: undefined, memory: undefined }).cpu, null);
  assert.equal(metrics(normalizeSnapshot({ ...next, memory: { totalBytes: 100 } })).memoryPercent, null);
  assert.equal(metrics(normalizeSnapshot({ ...next, memory: { totalBytes: 0, availableBytes: 0 } })).memoryPercent, null);
  next.errors = [{ collector: "memory", code: "timeout", message: "secret" }];
  s = normalizeSnapshot(next);
  assert.equal(metrics(s).memoryPercent, null); assert.equal(s.memory?.totalBytes, undefined);
  assert.equal(JSON.stringify(s).includes("secret"), false);
  assert.throws(() => normalizeSnapshot(null));
  assert.throws(() => normalizeSnapshot({ ...next, timestamp: "invalid" }));
});
test("disk counters reset on rollback, disappearance, errors, unsafe integers and reboot", () => {
  const a = normalizeSnapshot(raw()), b = normalizeSnapshot(raw(1));
  b.disks[0].readsCompleted = 0;
  assert.equal(metrics(b, a).diskRates[0].readIOPS, null);
  assert.equal(metrics(normalizeSnapshot(raw(1)), { ...a, disks: [] }).diskRates[0].readIOPS, null);
  const next = raw(1); next.disks[0].readBytes = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(metrics(normalizeSnapshot(next), a).diskRates[0].readBytesPerS, null);
  const failed = raw(1); failed.errors = [{ collector: "disk", code: "timeout" }];
  assert.equal(metrics(normalizeSnapshot(raw(2)), normalizeSnapshot(failed)).diskRates[0].readIOPS, null);
  assert.equal(metrics({ ...b, bootTimeSeconds: 456 }, a).diskRates[0].readIOPS, null);
});
test("backend coalesces polling, falls back to public version, resets on token change and disconnect", async () => {
  let now = 100_000, calls = 0, step = 0, fail = false;
  const monitor = new SmaMonitor(async (url, init) => {
    calls++;
    if (String(url).endsWith("/version")) { assert.equal(init?.headers, undefined); return Response.json({ version: "v0.2.7" }); }
    if (fail) return new Response(null, { status: 401 });
    const s = raw(step); return Response.json({ ...s, agentVersion: undefined });
  }, () => now);
  const [a, b] = await Promise.all([monitor.get("owner:agent", "http://agent", "secret"), monitor.get("owner:agent", "http://agent", "secret")]);
  assert.equal(calls, 2); assert.equal(a, b); assert.equal(a.agentVersion, "v0.2.7"); assert.equal(a.metrics.cpuPercent, null);
  now += 30_001; step++;
  assert.ok((await monitor.get("owner:agent", "http://agent", "secret")).metrics.cpuPercent! > 0);
  assert.equal((await monitor.get("owner:agent", "http://agent", "new-token")).metrics.cpuPercent, null);
  now += 30_001; fail = true;
  await assert.rejects(() => monitor.get("owner:agent", "http://agent", "new-token"), /Token/);
  const count = calls;
  await assert.rejects(() => monitor.get("owner:agent", "http://agent", "new-token")); assert.equal(calls, count);
  now += 30_001; step++; fail = false;
  assert.equal((await monitor.get("owner:agent", "http://agent", "new-token")).metrics.cpuPercent, null);
});
test("snapshot version takes priority; failed public version leaves metrics usable and version unknown", async () => {
  let calls = 0;
  const primary = new SmaMonitor(async () => { calls++; return Response.json(raw()); });
  assert.equal((await primary.get("a", "http://agent", null)).agentVersion, "v0.2.8"); assert.equal(calls, 1);
  const unknown = new SmaMonitor(async (url) => String(url).endsWith("/version") ? new Response(null, { status: 404 }) : Response.json({ ...raw(), agentVersion: "v1" }));
  const result = await unknown.get("a", "http://agent", null);
  assert.equal(result.agentVersion, null); assert.equal(result.metrics.memoryPercent, 60);
});
test("true idle and zero disk throughput remain zero rather than unavailable", () => {
  const a = raw(), b = raw(1);
  b.cpu.seconds.total.user = a.cpu.seconds.total.user;
  b.cpu.seconds.total.iowait = a.cpu.seconds.total.iowait;
  b.disks = a.disks;
  const result = metrics(normalizeSnapshot(b), normalizeSnapshot(a));
  assert.equal(result.cpuPercent, 0); assert.equal(result.diskRates[0].readBytesPerS, 0); assert.equal(result.diskRates[0].writeIOPS, 0);
});
test("partial filesystem failure preserves valid root capacity and still reports the collector error", () => {
  const input = raw(); input.errors = [{ collector: "filesystem", code: "collection_failed" }];
  const snapshot = normalizeSnapshot(input);
  assert.equal(metrics(snapshot).systemDiskPercent, 75);
  assert.equal(snapshot.errors[0].collector, "filesystem");
  snapshot.filesystems = [];
  assert.equal(metrics(snapshot).systemDiskPercent, null);
});
test("derived fractional boot time jitter does not reset Windows CPU/IO; real reboot still does", () => {
  const a = normalizeSnapshot(raw()), b = normalizeSnapshot(raw(1));
  a.bootTimeSeconds = 1792079388.069; b.bootTimeSeconds = 1792079388.074;
  assert.ok(metrics(b, a).cpuPercent! > 0); assert.equal(metrics(b, a).diskRates[0].readIOPS, 1);
  b.bootTimeSeconds += 2; assert.equal(metrics(b, a).cpuPercent, null);
  b.bootTimeSeconds = a.bootTimeSeconds; b.uptimeSeconds = 1; assert.equal(metrics(b, a).cpuPercent, null);
});
