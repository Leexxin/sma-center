import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBoardWrite,
  parseWidgets,
  moveWidget,
  starterWidgets,
  type Widget,
} from "../lib/workspace-model.ts";
const note: Widget = {
  version: 1,
  id: "note-1",
  type: "note",
  title: "值班",
  size: "wide",
  resourceId: "",
  metric: "cpuPercent",
  text: "hello",
  threshold: 90,
};
test("board validation rejects executable/unknown card types, duplicate ids, bad ranges and missing bindings", () => {
  assert.equal(
    parseBoardWrite({ name: " 总览 ", revision: 0, widgets: [note] }).name,
    "总览",
  );
  for (const w of [
    { ...note, type: "script" },
    { ...note, metric: "__proto__" },
    { ...note, threshold: Infinity },
    { ...note, threshold: -1 },
    { ...note, type: "resource" },
    { ...note, text: "x".repeat(4001) },
  ])
    assert.throws(() => parseWidgets([w]));
  assert.throws(() => parseWidgets([note, note]));
  assert.throws(() => parseWidgets(Array(61).fill(note)));
  assert.throws(() => parseBoardWrite({ name: "", revision: 0, widgets: [] }));
  assert.throws(() =>
    parseBoardWrite({ name: "ok", revision: -1, widgets: [] }),
  );
});
test("layout moves are deterministic and preserve card identities without mutating the saved layout", () => {
  const cards = [note, { ...note, id: "note-2" }, { ...note, id: "note-3" }];
  assert.deepEqual(
    moveWidget(cards, "note-1", 2).map((w) => w.id),
    ["note-2", "note-3", "note-1"],
  );
  assert.equal(cards[0].id, "note-1");
  assert.equal(moveWidget(cards, "note-1", -1), cards);
});
test("default migration projects existing resource ids and does not synthesize metrics or credentials", () => {
  const cards = starterWidgets([{ id: "existing", kind: "database" }]);
  assert(cards.some((w) => w.resourceId === "existing"));
  assert(cards.every((w) => !["metric", "timeseries"].includes(w.type)));
  assert.equal(new Set(cards.map((w) => w.id)).size, cards.length);
  assert.deepEqual(parseWidgets(cards), cards);
});
