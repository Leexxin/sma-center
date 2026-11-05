import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TotpAuth, totp } from "../deploy/totp-auth.mjs";

test(
  "workspace persists layouts, rejects stale writes, exports boards and samples without a dashboard open",
  { timeout: 145000, skip: process.env.SMA_CENTER_BROWSER_TEST !== "1" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "sma-workspace-browser-")),
      profile = join(directory, "chrome");
    const endpoint = createServer();
    await new Promise((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
    const port = endpoint.address().port;
    await new Promise((resolve) => endpoint.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    let requests = 0;
    const agent = createServer((req, res) => {
      if (req.url === "/version") {
        res.end(JSON.stringify({ version: "v0.2.8" }));
        return;
      }
      requests++;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          schemaVersion: "v1",
          agentVersion: "v0.2.8",
          timestamp: new Date().toISOString(),
          host: {
            hostname: "qa-node",
            os: "linux",
            architecture: "amd64",
            systemMountpoint: "/",
          },
          cpu: {
            logicalCount: 1,
            seconds: {
              cpu0: { idle: 100 + requests * 20, user: 100 + requests * 10 },
            },
          },
          memory: { totalBytes: 1000, availableBytes: 600 },
          filesystems: [
            {
              device: "root",
              mountpoint: "/",
              sizeBytes: 1000,
              availableBytes: 500,
            },
          ],
          disks: [],
          errors: [],
        }),
      );
    });
    await new Promise((resolve) => agent.listen(0, "127.0.0.1", resolve));
    const signing = "isolated-workspace-signing",
      auth = new TotpAuth(directory, signing, () => Date.now() - 60000);
    const enrollment = auth.authorizeSetup(
        readFileSync(join(directory, "setup-code.txt"), "utf8").trim(),
      ),
      seed = auth.pending(enrollment);
    assert(
      auth.confirmSetup(
        enrollment,
        totp(seed, Math.floor((Date.now() - 60000) / 30000)),
      ),
    );
    writeFileSync(
      join(directory, "secrets.json"),
      JSON.stringify({
        session: signing,
        credential: Buffer.alloc(32, 6).toString("base64"),
      }),
      { mode: 0o600 },
    );
    const children = [];
    let socket;
    const errors = [];
    try {
      children.push(
        spawn(process.execPath, ["deploy/server.mjs"], {
          env: {
            ...process.env,
            NODE_ENV: "production",
            SMA_CENTER_SELF_HOSTED: "1",
            SMA_CENTER_DATA_DIR: directory,
            PORT: String(port),
            SMA_CENTER_MONITOR_ENABLED: "true",
          },
          stdio: "pipe",
        }),
      );
      let log = "";
      children[0].stderr.on("data", (data) => {
        log += data;
      });
      children[0].stdout.on("data", (data) => {
        log += data;
      });
      let ready = false;
      for (let i = 0; i < 180; i++) {
        try {
          if ((await fetch(origin + "/healthz")).ok) {
            ready = true;
            break;
          }
        } catch {}
        await delay(100);
      }
      assert(ready, log);
      assert.equal((await fetch(origin + "/api/dashboards")).status, 401);
      assert.equal((await fetch(origin + "/favicon.png")).status, 200);
      children.push(
        spawn(
          process.env.CHROME_BIN ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          [
            "--headless=new",
            "--no-proxy-server",
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--user-data-dir=" + profile,
            "--remote-debugging-port=0",
            "about:blank",
          ],
          { stdio: "ignore" },
        ),
      );
      const activePort = join(profile, "DevToolsActivePort");
      for (let i = 0; i < 100 && !existsSync(activePort); i++) await delay(100);
      assert(existsSync(activePort));
      const debugPort = readFileSync(activePort, "utf8").split("\n")[0],
        tab = await (
          await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
            method: "PUT",
          })
        ).json();
      socket = new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
      });
      let sequence = 0;
      const pending = new Map();
      const call = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          socket.send(JSON.stringify({ id, method, params }));
        });
      socket.onmessage = (e) => {
        const m = JSON.parse(e.data),
          p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error.message));
          else p.resolve(m.result);
        }
        if (m.method === "Runtime.exceptionThrown")
          errors.push(m.params.exceptionDetails.text);
      };
      const evaluate = async (expression) => {
        const r = await call("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
        return r.result.value;
      };
      const until = async (expression) => {
        for (let i = 0; i < 250; i++) {
          if (await evaluate(expression)) return;
          await delay(100);
        }
        throw new Error("Expected state: " + expression + "\n" + log);
      };
      const api = async (path, method = "GET", body) =>
        evaluate(
          `fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},${body === undefined ? "" : `body:${JSON.stringify(JSON.stringify(body))},`}}).then(async r=>{const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null}})`,
        );
      await call("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await call("Page.enable");
      await call("Runtime.enable");
      await call("Page.navigate", { url: origin + "/login" });
      await until("!!document.querySelector('#code')");
      await evaluate(
        `document.querySelector('#code').value=${JSON.stringify(totp(seed, Math.floor(Date.now() / 30000)))};document.querySelector('form').requestSubmit()`,
      );
      await until(
        "!!document.querySelector('.workspace') && document.body.textContent.includes('更新于')",
      );
      assert.equal(
        await evaluate(
          "document.body.textContent.includes('个人空间')||document.body.textContent.includes('仅自己可见')||document.body.textContent.includes('一切，尽在掌握')",
        ),
        false,
      );
      const geometry = await evaluate(
        "(()=>{const s=document.querySelector('.ws-sidebar').getBoundingClientRect(),m=document.querySelector('.ws-main').getBoundingClientRect();return {sidebar:s.width,main:m.width,left:m.left,top:m.top,sideRight:s.right}})()",
      );
      assert(
        geometry.sidebar >= 170 && geometry.sidebar <= 220,
        "sidebar geometry: " + JSON.stringify(geometry),
      );
      assert(
        geometry.main > 900 &&
          geometry.left >= geometry.sideRight - 1 &&
          geometry.top < 5,
        "desktop geometry: " + JSON.stringify(geometry),
      );
      const before = (await api("/api/dashboards")).body;
      assert.equal(before.length, 1);
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent==='编辑').click()",
      );
      await until("!!document.querySelector('.ws-editbar')");
      const original = await evaluate(
        "[...document.querySelectorAll('[data-widget-id]')].map(e=>e.dataset.widgetId)",
      );
      await evaluate("document.querySelector('[aria-label=后移卡片]').click()");
      const moved = await evaluate(
        "[...document.querySelectorAll('[data-widget-id]')].map(e=>e.dataset.widgetId)",
      );
      assert.notDeepEqual(moved, original);
      await evaluate("document.querySelector('[aria-label=撤销]').click()");
      assert.deepEqual(
        await evaluate(
          "[...document.querySelectorAll('[data-widget-id]')].map(e=>e.dataset.widgetId)",
        ),
        original,
      );
      await evaluate("document.querySelector('[aria-label=重做]').click()");
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent==='保存').click()",
      );
      await until("!document.querySelector('.ws-editbar')");
      await call("Page.reload");
      await until("!!document.querySelector('.workspace')");
      assert.deepEqual(
        await evaluate(
          "[...document.querySelectorAll('[data-widget-id]')].map(e=>e.dataset.widgetId)",
        ),
        moved,
      );
      await until("document.body.textContent.includes('更新于')");
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent==='添加卡片').click()",
      );
      await until("!!document.querySelector('.ws-templates')");
      await evaluate(
        "[...document.querySelectorAll('.ws-templates button')].find(b=>b.textContent.includes('文本')).click()",
      );
      await until("!!document.querySelector('.ws-config textarea')");
      await evaluate("document.querySelector('.ws-config textarea').focus()");
      await call("Input.insertText", { text: "Maintenance note" });
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until("!document.querySelector('[role=dialog]')");
      assert(
        await evaluate(
          "document.body.textContent.includes('Maintenance note')",
        ),
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent==='保存').click()",
      );
      await until("!document.querySelector('.ws-editbar')");
      const stale = before[0];
      assert.equal(
        (await api("/api/dashboards/" + stale.id, "PUT", stale)).status,
        409,
      );
      const note = {
        version: 1,
        id: "qa-note",
        type: "note",
        title: "值班",
        size: "medium",
        resourceId: "",
        metric: "cpuPercent",
        text: "<script>never execute</script>",
        threshold: 90,
      };
      const added = await api("/api/dashboards", "POST", {
        name: "测试面板",
        revision: 0,
        widgets: [note],
      });
      assert.equal(added.status, 201);
      assert.equal(
        (
          await api("/api/dashboards", "POST", {
            name: "invalid",
            revision: 0,
            widgets: [note, note],
          })
        ).status,
        400,
      );
      const dbResource = await api("/api/resources", "POST", {
        kind: "database",
        name: "QA PostgreSQL",
        url: "https://db.example.invalid",
        status: "unknown",
      });
      assert.equal(dbResource.status, 201);
      const resource = await api("/api/resources", "POST", {
        kind: "server",
        name: "QA Node",
        url: "https://node.example.invalid",
        status: "unknown",
        agentUrl: `http://127.0.0.1:${agent.address().port}`,
      });
      assert.equal(resource.status, 201);
      const backup = await api("/api/backup");
      assert.equal(backup.status, 200);
      assert(backup.body.dashboards.some((b) => b.name === "测试面板"));
      assert(!JSON.stringify(backup.body).includes("ciphertext"));
      const restored = await api("/api/backup", "POST", {
        backup: backup.body,
        mode: "merge",
      });
      assert.equal(restored.status, 200);
      assert(
        (await api("/api/dashboards")).body.some((b) => b.name === "测试面板"),
      );
      // Remove the UI from the tab; sampling must continue in the gateway process.
      await call("Page.navigate", { url: origin + "/security" });
      await until("location.pathname==='/security'");
      for (let i = 0; i < 1000 && requests < 2; i++) await delay(100);
      assert(
        requests >= 2,
        "background sampler keeps running with no dashboard open; requests=" +
          requests +
          ": " +
          log,
      );
      await call("Page.navigate", { url: origin + "/" });
      await until(
        "!!document.querySelector('.workspace') && document.body.textContent.includes('更新于')",
      );
      const observed = await api("/api/observability");
      const sample = observed.body.samples.find(
        (s) => s.resourceId === resource.body.id,
      );
      assert(sample);
      assert.equal(sample.payload.memoryPercent, 40);
      assert.equal(sample.quality, "valid");
      const history = await api(
        `/api/observability?resourceId=${resource.body.id}&metric=memoryPercent&hours=1`,
      );
      assert(history.body.points.some((p) => p.value === 40));
      assert(history.body.points.length <= 361);
      assert.equal(
        (await api("/api/observability?resourceId=not-owned")).status,
        404,
      );
      await api("/api/resources/" + resource.body.id, "DELETE");
      assert(
        !(await api("/api/observability")).body.samples.some(
          (s) => s.resourceId === resource.body.id,
        ),
      );
      await call("Page.navigate", { url: origin + "/" });
      await until("!!document.querySelector('.workspace')");
      await call("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      if (process.env.SMA_CENTER_WORKSPACE_SCREENSHOT) {
        await call("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await evaluate(
          "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
        );
        const shot = await call("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
        });
        writeFileSync(
          process.env.SMA_CENTER_WORKSPACE_SCREENSHOT,
          Buffer.from(shot.data, "base64"),
        );
      }
      assert.deepEqual(errors, []);
    } finally {
      socket?.close();
      await Promise.all(
        children.map(
          (child) =>
            new Promise((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null)
                return resolve();
              child.once("exit", resolve);
              child.kill("SIGTERM");
              const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
              timer.unref();
            }),
        ),
      );
      await new Promise((resolve) => agent.close(resolve));
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);
