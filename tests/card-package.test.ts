import test from "node:test";
import assert from "node:assert/strict";
import {
  builtinCards,
  packageOnly,
  parseCardPackage,
  parseCardValues,
  editableCardValues,
  parseCardState,
  createCardId,
} from "../lib/card-package.ts";
import { parseWidgets } from "../lib/workspace-model.ts";
import { reportedStatus } from "../lib/resource-status.ts";
test("packages reject scripts, unknown renderers, duplicate fields and invalid dates or timezone", () => {
  const p = packageOnly(builtinCards[0]);
  assert.equal(parseCardPackage(p).renderer, "clock");
  for (const input of [
    { ...p, script: "alert(1)" },
    { ...p, renderer: "iframe" },
    { ...p, id: "../escape" },
    { ...p, icon: "javascript:" },
    { ...p, fields: [...p.fields, p.fields[0]] },
    {
      ...p,
      fields: [{ ...p.fields[0], default: "Invalid/Zone" }, p.fields[1]],
    },
    { ...p, fields: [] },
    { ...p, fields: [{ ...p.fields[0], key: "constructor" }, p.fields[1]] },
  ])
    assert.throws(() => parseCardPackage(input));
  const countdown = packageOnly(builtinCards[1]);
  assert.throws(() =>
    parseCardValues(countdown, { target: "2027-01-01T00:00" }),
  );
  assert.equal(
    parseCardValues(countdown, { target: "2027-01-01T00:00:00+08:00" }).target,
    "2027-01-01T00:00:00+08:00",
  );
});
test("required, typed and unknown configuration fields are validated without evaluating content", () => {
  const p = packageOnly(builtinCards[4]);
  p.fields[0].required = true;
  assert.throws(() => parseCardValues(p, {}));
  assert.throws(() => parseCardValues(p, { content: 4 }));
  assert.throws(() => parseCardValues(p, { content: "ok", extra: "x" }));
  assert.equal(
    parseCardValues(p, { content: "<script>alert(1)</script>" }).content,
    "<script>alert(1)</script>",
  );
  const widget = {
    version: 1,
    id: "test-card",
    type: "plugin",
    title: "",
    size: "medium",
    resourceId: "",
    metric: "cpuPercent",
    text: "",
    threshold: 90,
    pluginId: p.id,
    values: { content: "safe" },
    icon: "clock",
  };
  assert.equal(parseWidgets([widget])[0].pluginId, p.id);
  assert.throws(() => parseWidgets([{ ...widget, pluginId: "http://bad" }]));
  assert.throws(() =>
    parseWidgets([{ ...widget, values: { content: { html: "bad" } } }]),
  );
});
test("card ids work with getRandomValues independently of secure-context randomUUID", () => {
  const ids = new Set(Array.from({ length: 500 }, () => createCardId()));
  assert.equal(ids.size, 500);
  for (const id of ids)
    assert.match(
      id,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
});
test("interactive card state is bounded, unique and explicit", () => {
  assert.deepEqual(parseCardState({ text: "memo" }), { text: "memo" });
  assert.throws(() => parseCardState({ text: "x".repeat(4001) }));
  assert.throws(() => parseCardState({ html: "script" }));
  const item = { id: "a", text: "todo", done: false };
  assert.throws(() => parseCardState({ items: [item, item] }));
  assert.throws(() => parseCardState({ items: [{ ...item, done: "false" }] }));
  assert.deepEqual(parseCardState({ items: [item] }).items, [item]);
});
test("resource status comes from reports and freshness, never manually entered status", () => {
  const resource = {
    kind: "server",
    agentUrl: "http://agent",
    status: "online",
  };
  assert.equal(
    reportedStatus(resource, { quality: "partial", timestamp: 1000 }, 2000)
      .tone,
    "warning",
  );
  assert.equal(
    reportedStatus(resource, { quality: "valid", timestamp: 1000 }, 200000)
      .label,
    "上报已过期",
  );
  assert.equal(
    reportedStatus({ kind: "site", status: "online" } as { kind: string })
      .label,
    "未接入状态上报",
  );
});

test("explicit reconfiguration prunes removed fields and repairs changed field types", () => {
  const def = packageOnly(builtinCards[4]);
  assert.deepEqual(editableCardValues(def, { removed: "old", content: 4 }), {
    content: "",
  });
  assert.deepEqual(
    editableCardValues(def, { content: "keep", removed: "old" }),
    { content: "keep" },
  );
});
