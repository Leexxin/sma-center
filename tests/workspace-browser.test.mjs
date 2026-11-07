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
import { builtinCards, packageOnly } from "../lib/card-package.ts";
import { TotpAuth, totp } from "../deploy/totp-auth.mjs";

test(
  "workspace persists layouts, rejects stale writes, exports boards and samples without a dashboard open",
  { timeout: 235000, skip: process.env.SMA_CENTER_BROWSER_TEST !== "1" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "sma-workspace-browser-")),
      profile = join(directory, "chrome");
    const endpoint = createServer();
    await new Promise((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
    const port = endpoint.address().port;
    await new Promise((resolve) => endpoint.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    let requests = 0;
    const favicon = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=", "base64");
    const agent = createServer((req, res) => {
      if (req.url === "/site/") { res.setHeader("Content-Type", "text/html"); res.end('<link rel="icon" href="/site/assets/logo.png">'); return; }
      if (req.url === "/site/assets/logo.png") { res.setHeader("Content-Type", "image/png"); res.end(favicon); return; }

      if (req.url.endsWith("/version")) {
        res.end(JSON.stringify({ version: "v0.2.8" }));
        return;
      }
      if (req.url === "/v1/discovery/capabilities") {
        res.end(
          JSON.stringify({
            enabled: true,
            detectors: ["database", "middleware"],
            reportEnabled: false,
            maxConcurrency: 1,
          }),
        );
        return;
      }
      if (req.url === "/v1/discovery/runs") {
        res.end(JSON.stringify({ runs: [] }));
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
          errors: req.url.startsWith("/normal/") ? [] : [{ collector: "disk", code: "permission_denied" }],
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
    writeFileSync(join(directory, "oidc-clients.json"), JSON.stringify([{
      client_id: "qa-app", name: "QA Business App", entry_url: origin + "/business-login",
      redirect_uris: [origin + "/business-callback"], secret_sha256: "a".repeat(64),
    }]), { mode: 0o600 });
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
            SMA_CENTER_SSO_ISSUER: origin,
            SMA_CENTER_SECURE_COOKIES: "false",
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
          errors.push(
            m.params.exceptionDetails.exception?.description ||
              m.params.exceptionDetails.text,
          );
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
        const shot = await call("Page.captureScreenshot", { format: "png" });
        writeFileSync(
          "/private/tmp/sma-cards-failure.png",
          Buffer.from(shot.data, "base64"),
        );
        throw new Error(
          "Expected state: " +
            expression +
            "\n" +
            log +
            "\nBODY: " +
            (await evaluate("document.body.textContent.slice(0,4000)")) +
            "\nEXCEPTIONS: " +
            JSON.stringify(errors),
        );
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
      await call("Page.addScriptToEvaluateOnNewDocument", {
        source:
          "Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true})",
      });
      await call("Runtime.enable");
      await call("Emulation.setFocusEmulationEnabled", { enabled: true });
      await call("Page.navigate", { url: origin + "/login" });
      await until("document.readyState===\'complete\'");
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
      const catalog = await api("/api/applications");
      assert.deepEqual(catalog.body.applications, [{ id: "qa-app", name: "QA Business App", url: origin + "/business-login" }]);
      await call("Page.navigate", { url: origin + "/applications" });
      await until("document.readyState===\'complete\'");
      await until("location.pathname==='/resources' && location.search==='?kind=application' && document.querySelector('.resources-grid')?.textContent.includes('QA Business App')");
      assert.equal(await evaluate("!!document.querySelector('.ws-sidebar a[href=\"/applications\"]')"), false);
      await call("Page.navigate", { url: origin + "/" });
      await until("document.readyState===\'complete\'");
      await until("!!document.querySelector('.workspace') && document.body.textContent.includes('更新于')");
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
      // Events are a separate page, including repeated navigation from resources.
      for (let visit = 0; visit < 2; visit++) {
        await call("Page.navigate", { url: origin + "/resources" });
        await until("document.readyState===\'complete\'");
        await until("location.pathname==='/resources' && !!document.querySelector('.resources-grid')");
        await evaluate("document.querySelector('.ws-sidebar a[href=\"/events\"]').click()");
        await until("location.pathname==='/events' && document.querySelector('h1')?.textContent==='事件' && !document.querySelector('.ws-grid') && document.body.textContent.includes('暂无事件')");
        assert.equal(await evaluate("!!document.querySelector('[role=dialog]')"),false);
      }
      // The old resource entry opens management inside the overview frame.
      await call("Page.navigate", { url: origin + "/resources" });
      await until("document.readyState===\'complete\'");
      await until(
        "location.pathname==='/resources' && !!document.querySelector('.resources-grid') && !!document.documentElement.dataset.theme",
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent==='添加资源').click()",
      );
      await until("!!document.querySelector('.ws-config input[type=url]')");
      for (const [label, text] of [
        ["名称", "UI Resource"],
        ["地址", "https://ui.example.invalid"],
      ]) {
        await evaluate(
          `(()=>{const label=[...document.querySelectorAll('.ws-config label')].find(e=>e.firstChild.textContent.trim()===${JSON.stringify(label)});label.querySelector('input').focus()})()`,
        );
        await call("Input.insertText", { text });
      }
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until(
        "document.querySelector('.resources-grid')?.textContent.includes('UI Resource')",
      );
      assert(
        (await api("/api/resources")).body.some(
          (r) => r.name === "UI Resource",
        ),
      );
      await evaluate(
        "[...document.querySelectorAll('.resource-tile')].find(e=>e.textContent.includes('UI Resource')).querySelector('a[href^=\"/?resource=\"]').click()",
      );
      await until(
        "!!document.querySelector('.ws-config select[required]') && document.body.textContent.includes('更新于')",
      );
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until(
        "!document.querySelector('[role=dialog]') && document.body.textContent.includes('UI Resource')",
      );
      assert.equal(
        await evaluate("!!document.querySelector('.ws-editbar')"),
        false,
      );
      await call("Page.navigate", { url: origin + "/" });
      await until("document.readyState===\'complete\'");
      await until(
        "!!document.querySelector('.workspace') && document.body.textContent.includes('更新于') && !document.querySelector('[role=dialog]')",
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
      assert.equal(
        await evaluate("!!document.querySelector('.ws-editbar')"),
        false,
      );
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
        agentToken: "isolated-qa-agent-token",
      });
      assert.equal(resource.status, 201);
      assert.equal((await api("/api/site-icon", "POST", { url: "file:///etc/passwd" })).status, 400);
      const site = await api("/api/resources", "POST", {
        kind: "site", name: "QA Icon Site", url: `http://127.0.0.1:${agent.address().port}/site/`,
      });
      assert.equal(site.status, 201);
      assert.equal(site.body.siteIcon, `data:image/png;base64,${favicon.toString("base64")}`);
      const normal = await api("/api/resources", "POST", {
        kind: "server", name: "QA Healthy Node", url: "https://healthy.example.invalid",
        agentUrl: `http://127.0.0.1:${agent.address().port}/normal`, agentToken: "isolated-qa-agent-token",
      });
      assert.equal(normal.status, 201);
      await call("Page.navigate", { url: origin + "/resources" });
      await until("document.readyState===\'complete\'");
      await until("document.querySelector('.resources-grid')?.textContent.includes('QA Business App') && [...document.querySelectorAll('.resource-tile')].some(e=>e.textContent.includes('QA Icon Site') && e.querySelector('img.site-favicon')?.naturalWidth===1)");
      assert.equal(await evaluate("[...document.querySelectorAll('.resource-tile')].find(e=>e.textContent.includes('QA Icon Site')).querySelector('img.site-favicon').naturalWidth"), 1);
      await evaluate("document.querySelector('[aria-label=\"编辑 QA Icon Site\"]').click()");
      await until("document.querySelector('.site-icon-setting img.site-favicon')?.naturalWidth===1");
      assert.equal(await evaluate("document.querySelector('.site-icon-setting img.site-favicon').naturalWidth"), 1);
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='重新采集').click()");
      await until("document.querySelector('.site-icon-setting').textContent.includes('已采集站点图标')");
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until("!document.querySelector('.site-icon-setting')");
      const ipResource = await api("/api/resources", "POST", {kind:"server",name:"QA IP Server",url:"192.0.2.10"});
      assert.equal(ipResource.status,201);
      await call("Page.navigate", {url:origin+"/resources"});
      await until("document.readyState===\'complete\'");
      await until("!!document.querySelector('[aria-label=\"编辑 QA IP Server\"]')");
      await evaluate("document.querySelector('[aria-label=\"编辑 QA IP Server\"]').click()");
      await until("!!document.querySelector('.ws-config')");
      assert.equal(await evaluate("[...document.querySelectorAll('.ws-config input')].find(i=>i.value==='192.0.2.10').type"),"text");
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until("!document.querySelector('.ws-config')");
      const databasePassword="isolated-qa-database-password";
      const dbConnection={service:"mysql",host:"192.0.2.80",port:3306,username:"app",database:"appdb",purpose:"test connection"};
      const databaseResource=await api("/api/resources","POST",{kind:"database",name:"QA Secure Database",database:dbConnection,databasePassword});
      assert.equal(databaseResource.status,201);
      assert.equal(databaseResource.body.credentialConfigured,true);
      assert.deepEqual(databaseResource.body.database,dbConnection);
      assert(!JSON.stringify(databaseResource.body).includes(databasePassword));
      const unchangedDatabase=await api("/api/resources/"+databaseResource.body.id,"PATCH",{...databaseResource.body,name:"QA Secure Database"});
      assert.equal(unchangedDatabase.status,200);
      assert.equal(unchangedDatabase.body.credentialConfigured,true);
      const {DatabaseSync}=await import("node:sqlite");
      const {decryptCredential}=await import("../lib/credential-crypto.ts");
      const verifyDb=new DatabaseSync(join(directory,"sma-center.sqlite"),{readOnly:true});
      const encrypted=verifyDb.prepare("SELECT * FROM database_credentials WHERE resource_id=?").get(databaseResource.body.id);
      assert(encrypted && encrypted.ciphertext!==databasePassword);
      assert.equal(await decryptCredential({ciphertext:encrypted.ciphertext,iv:encrypted.iv,keyVersion:encrypted.key_version},Buffer.alloc(32,6).toString("base64"),"selfhost:admin","database:"+databaseResource.body.id),databasePassword);
      verifyDb.close();
      await call("Page.navigate",{url:origin+"/resources"});
      await until("document.readyState===\'complete\'");
      await until("!!document.querySelector('[aria-label=\"编辑 QA Secure Database\"]')");
      assert.equal(await evaluate("[...document.querySelectorAll('.resource-tile')].find(e=>e.textContent.includes('QA Icon Site')).querySelector('.status-indicator')===null"),true);
      await evaluate("document.querySelector('[aria-label=\"编辑 QA Secure Database\"]').click()");
      await until("!!document.querySelector('input[autocomplete=\"new-password\"]')");
      assert.equal(await evaluate("document.querySelector('input[autocomplete=\"new-password\"]').value"),"");
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until("!document.querySelector('.ws-config')");
      // Editing metadata must preserve an existing write-only credential.
      await call("Page.navigate", { url: origin + "/?view=resources" });
      await until("document.readyState===\'complete\'");
      await until(
        "document.querySelector('.resources-grid')?.textContent.includes('QA Node') && !!document.documentElement.dataset.theme",
      );
      await evaluate(
        "document.querySelector('[aria-label=\"编辑 QA Node\"]').click()",
      );
      await until("!!document.querySelector('input[type=password]')");
      assert.equal(
        await evaluate("document.querySelector('input[type=password]').value"),
        "",
      );
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until("!document.querySelector('input[type=password]')");
      assert.equal(
        (await api("/api/resources")).body.find(
          (r) => r.id === resource.body.id,
        ).credentialConfigured,
        true,
      );
      const baselineBoards = (await api("/api/dashboards")).body;
      const mainBoard = baselineBoards[0];
      await call("Page.navigate", { url: origin + "/?view=gallery" });
      await until("document.readyState===\'complete\'");
      await until(
        "location.pathname==='/cards' && !!document.documentElement.dataset.theme && !!document.querySelector('.card-type-grid')",
      );
      assert.equal(
        await evaluate("!!document.querySelector('.ws-editbar')"),
        false,
      );
      assert.equal(
        (await api("/api/dashboards")).body[0].revision,
        mainBoard.revision,
      );
      await call("Page.navigate", { url: origin + "/" });
      await until("document.readyState===\'complete\'");
      await until("document.body.textContent.includes('更新于')");
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent==='添加卡片').click()",
      );
      await until("!!document.querySelector('.ws-templates')");
      assert.equal(await evaluate("typeof crypto.randomUUID"), "undefined");
      assert.equal(
        await evaluate("!!document.querySelector('.ws-editbar')"),
        false,
      );
      await evaluate(
        "document.querySelector('[data-slot=dialog-close]').click()",
      );
      await until("!document.querySelector('[role=dialog]')");
      assert.equal(
        (await api("/api/dashboards")).body[0].revision,
        mainBoard.revision,
      );
      const manifest = {
        ...packageOnly(builtinCards[0]),
        id: "qa.clock",
        name: "QA Clock",
      };
      const file = join(directory, "qa-clock.sma-card.json");
      writeFileSync(file, JSON.stringify(manifest));
      await call("Page.navigate", { url: origin + "/plugins" });
      await until("document.readyState===\'complete\'");
      await until(
        "location.pathname==='/plugins' && !!document.documentElement.dataset.theme",
      );
      const doc = await call("DOM.getDocument");
      const upload = await call("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: "input[type=file]",
      });
      await call("DOM.setFileInputFiles", {
        nodeId: upload.nodeId,
        files: [file],
      });
      await until(
        "document.querySelector('[role=dialog]')?.textContent.includes('QA Clock')",
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent==='确认导入').click()",
      );
      await until(
        "!document.querySelector('[role=dialog]') && document.querySelector('.card-type-grid')?.textContent.includes('QA Clock')",
      );
      assert.equal(
        (await api("/api/card-definitions", "POST", { manifest, revision: 0 }))
          .status,
        409,
      );
      assert.equal(
        (
          await api("/api/card-definitions", "POST", {
            manifest: { ...manifest, script: "fetch(1)" },
            revision: 1,
          })
        ).status,
        400,
      );
      await call("Page.navigate", { url: origin + "/?add=qa.clock" });
      await until("document.readyState===\'complete\'");
      await until(
        "!!document.querySelector('.ws-config') && document.body.textContent.includes('更新于')",
      );
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until(
        "!!document.querySelector('.card-clock') && !document.querySelector('[role=dialog]')",
      );
      const makeExtra = async (id) => {
        await call("Page.navigate", { url: origin + "/?add=" + id });
        await until("document.readyState===\'complete\'");
        await until(
          "!!document.querySelector('.ws-config') && document.body.textContent.includes('更新于')",
        );
        await evaluate("document.querySelector('.ws-config').requestSubmit()");
        await until("!document.querySelector('[role=dialog]')");
        return (await api("/api/dashboards")).body[0].widgets.find(
          (w) => w.pluginId === id,
        );
      };
      const memo = await makeExtra("sma.memo");
      await until(
        `!!document.querySelector('[data-widget-id="${memo.id}"] textarea:not(:disabled)')`,
      );
      await evaluate(
        `document.querySelector('[data-widget-id="${memo.id}"] textarea').focus()`,
      );
      await call("Input.insertText", { text: "Persistent memo" });
      await evaluate(
        `document.querySelector('[data-widget-id="${memo.id}"] .ws-text-link').click()`,
      );
      const memoPath =
        "/api/dashboards/" + mainBoard.id + "/widgets/" + memo.id + "/state";
      await until(
        `document.querySelector('[data-widget-id="${memo.id}"] .ws-text-link').disabled`,
      );
      assert.equal((await api(memoPath)).body.state.text, "Persistent memo");
      assert.equal(
        (await api(memoPath, "PUT", { state: { text: "stale" }, revision: 0 }))
          .status,
        409,
      );
      assert.equal(
        (await api("/api/dashboards/not-owned/widgets/" + memo.id + "/state"))
          .status,
        404,
      );
      const todo = await makeExtra("sma.todo");
      await until(
        `!!document.querySelector('[data-widget-id="${todo.id}"] input[aria-label="新待办"]:not(:disabled)')`,
      );
      await evaluate(
        `document.querySelector('[data-widget-id="${todo.id}"] input[aria-label="新待办"]').focus()`,
      );
      await call("Input.insertText", { text: "Check deployment" });
      await evaluate(
        `document.querySelector('[data-widget-id="${todo.id}"] form').requestSubmit()`,
      );
      await until(
        `!!document.querySelector('[data-widget-id="${todo.id}"] .card-todos input:not(:disabled)')`,
      );
      const layoutRevision = (await api("/api/dashboards")).body[0].revision;
      await evaluate(
        `document.querySelector('[data-widget-id="${todo.id}"] .card-todos input').click()`,
      );
      await until(
        `document.querySelector('[data-widget-id="${todo.id}"] .card-todos input').checked && !document.querySelector('[data-widget-id="${todo.id}"] .card-todos input').disabled`,
      );
      assert.equal(
        (
          await api(
            "/api/dashboards/" +
              mainBoard.id +
              "/widgets/" +
              todo.id +
              "/state",
          )
        ).body.state.items[0].done,
        true,
      );
      assert.equal(
        (await api("/api/dashboards")).body[0].revision,
        layoutRevision,
      );
      assert.equal(
        (await api("/api/card-definitions/qa.clock", "DELETE", { revision: 1 }))
          .status,
        409,
      );
      // A custom countdown package supplies a timezone-qualified default target.
      const countdown = packageOnly(
        builtinCards.find((p) => p.renderer === "countdown"),
      );
      countdown.id = "qa.countdown";
      countdown.fields[0] = {
        ...countdown.fields[0],
        default: "2030-01-01T00:00:00+08:00",
      };
      assert.equal(
        (
          await api("/api/card-definitions", "POST", {
            manifest: countdown,
            revision: 0,
          })
        ).status,
        200,
      );
      const countdownWidget = await makeExtra("qa.countdown");
      const revisedCountdown = {
        ...countdown,
        fields: countdown.fields.filter((f) => f.key !== "caption"),
      };
      assert.equal(
        (
          await api("/api/card-definitions", "POST", {
            manifest: revisedCountdown,
            revision: 1,
          })
        ).status,
        200,
      );
      await call("Page.navigate", { url: origin + "/" });
      await until("document.readyState===\'complete\'");
      await until(
        "document.body.textContent.includes('更新于') && document.body.textContent.includes('卡片字段已变更')",
      );
      await evaluate(
        `document.querySelector('[data-widget-id="${countdownWidget.id}"] button[aria-label^="查看"]').click()`,
      );
      await until("!!document.querySelector('.ws-config')");
      await evaluate("document.querySelector('.ws-config').requestSubmit()");
      await until(
        "!document.querySelector('[role=dialog]') && !document.body.textContent.includes('卡片字段已变更')",
      );
      await until("!!document.querySelector('.card-countdown strong')");
      const fields = await makeExtra("sma.fields");
      assert(fields);
      await call("Page.reload");
      await until(
        "document.body.textContent.includes('更新于') && !!document.querySelector('.card-todos input:checked')",
      );
      assert.equal(
        await evaluate(
          `document.querySelector('[data-widget-id="${memo.id}"] textarea').value`,
        ),
        "Persistent memo",
      );
      const backup = await api("/api/backup");
      assert.equal(backup.body.cardDefinitions.length, 2);
      assert.equal(backup.body.cardStates.length, 2);

      assert.equal(backup.status, 200);
      assert.equal(backup.body.resources.find(r => r.id === site.body.id).siteIcon, site.body.siteIcon);
      assert(backup.body.dashboards.some((b) => b.name === "测试面板"));
      assert(!JSON.stringify(backup.body).includes("ciphertext"));
      assert(!JSON.stringify(backup.body).includes(databasePassword));
      assert.deepEqual(backup.body.resources.find(r=>r.id===databaseResource.body.id).database,dbConnection);
      const restored = await api("/api/backup", "POST", {
        backup: backup.body,
        mode: "merge",
      });
      assert.equal(restored.status, 200);
      assert.equal(restored.body.resources.find(r=>r.id===databaseResource.body.id).credentialConfigured,true);
      assert.equal(restored.body.resources.find(r => r.id === site.body.id).siteIcon, site.body.siteIcon);
      const legacyBackup = structuredClone(backup.body);
      legacyBackup.resources.forEach(r => { delete r.siteIcon; });
      const legacyRestore = await api("/api/backup", "POST", { backup: legacyBackup, mode: "merge" });
      assert.equal(legacyRestore.status, 200);
      assert.equal(legacyRestore.body.resources.find(r => r.id === site.body.id).siteIcon, site.body.siteIcon);
      assert.equal((await api(memoPath)).body.state.text, "Persistent memo");
      assert((await api(memoPath)).body.revision > 1);
      const cleanupWidget = {
        version: 1,
        id: "cleanup-card",
        type: "plugin",
        pluginId: "sma.memo",
        values: { text: "" },
        title: "",
        size: "medium",
        resourceId: "",
        metric: "cpuPercent",
        text: "",
        threshold: 90,
      };
      const temporary = (
        await api("/api/dashboards", "POST", {
          name: "cleanup",
          revision: 0,
          widgets: [cleanupWidget],
        })
      ).body;
      const cleanupPath =
        "/api/dashboards/" + temporary.id + "/widgets/cleanup-card/state";
      assert.equal(
        (
          await api(cleanupPath, "PUT", {
            state: { text: "temporary" },
            revision: 0,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await api("/api/dashboards/" + temporary.id, "PUT", {
            ...temporary,
            widgets: [],
          })
        ).status,
        200,
      );
      assert.equal((await api(cleanupPath)).status, 404);
      assert(
        !(await api("/api/backup")).body.cardStates.some(
          (s) => s.widgetId === "cleanup-card",
        ),
      );
      assert.equal(
        (
          await api("/api/dashboards/" + temporary.id, "DELETE", {
            revision: 1,
          })
        ).status,
        200,
      );

      assert(
        (await api("/api/dashboards")).body.some((b) => b.name === "测试面板"),
      );
      // Global theme is persisted across React and native form pages.
      await call("Page.navigate", { url: origin + "/?view=settings" });
      await until("document.readyState===\'complete\'");
      await until("!!document.querySelector('.ui-settings')");
      assert.equal(
        await evaluate(
          "document.querySelector('.ui-settings').textContent.includes('欢迎语')",
        ),
        false,
      );
      const preference = restored.body.preferences;
      assert.equal(
        (
          await api("/api/preferences", "PUT", {
            ...preference,
            theme: "light",
            accent: "violet",
          })
        ).status,
        200,
      );
      const capture = async (name) => {
        if (!process.env.SMA_CENTER_CONSOLE_SCREENSHOTS) return;
        await evaluate(
          "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
        );
        const shot = await call("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
        });
        writeFileSync(
          join(process.env.SMA_CENTER_CONSOLE_SCREENSHOTS, name + ".png"),
          Buffer.from(shot.data, "base64"),
        );
      };
      for (const [path, heading] of [
        ["/", "总览"],
        ["/servers/" + resource.body.id, "QA Node"],
        ["/security", "安全设置"],
        ["/resources?kind=application", "业务应用"],
        ["/resources", "资源"],
        ["/events", "事件"],
        ["/cards", "卡片管理"],
        ["/plugins", "插件"],
        ["/not-a-page", "页面未找到"],
      ]) {
        await call("Page.navigate", { url: origin + path });
        await until("document.readyState===\'complete\'");
        await until(
          `location.pathname+location.search===${JSON.stringify(path)} && !!document.querySelector('.workspace.ws-light.ws-accent-violet') && document.body.textContent.includes(${JSON.stringify(heading)})`,
        );
        assert.equal(
          await evaluate("document.querySelectorAll('.ws-sidebar').length"),
          1,
        );
        await until(
          "getComputedStyle(document.querySelector('.workspace')).getPropertyValue('--ws-bg').trim()==='#f5f6fa'",
        );
        for (const width of [1440, 768, 390]) {
          await call("Emulation.setDeviceMetricsOverride", {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: width === 390,
          });
          assert.equal(
            await evaluate("document.documentElement.scrollWidth<=innerWidth"),
            true,
            path + " width " + width,
          );
          await capture(
            (path === "/" ? "overview" : path.split("/")[1]) + "-" + width,
          );
        }
      }
      await call("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      // Remove the UI from the tab; sampling must continue in the gateway process.
      await call("Page.navigate", { url: origin + "/security" });
      await until("document.readyState===\'complete\'");
      await until("location.pathname==='/security'");
      const requestsWithoutUI = requests;
      for (let i = 0; i < 1600 && requests < requestsWithoutUI + 4; i++)
        await delay(100);
      assert(
        requests >= requestsWithoutUI + 4,
        "background sampler keeps running with no dashboard open; initial=" +
          requestsWithoutUI +
          "; requests=" +
          requests +
          ": " +
          log,
      );
      await call("Page.navigate", { url: origin + "/" });
      await until("document.readyState===\'complete\'");
      await until(
        "!!document.querySelector('.workspace') && document.body.textContent.includes('更新于')",
      );
      const observed = await api("/api/observability");
      const sample = observed.body.samples.find(
        (s) => s.resourceId === resource.body.id,
      );
      assert(sample);
      assert.equal(sample.payload.memoryPercent, 40);
      assert.equal(sample.quality, "partial");
      assert.deepEqual(sample.payload.errors, [{ collector: "disk", code: "permission_denied" }]);
      await call("Page.navigate", { url: origin + "/resources" });
      await until("document.readyState===\'complete\'");
      await until("!!document.querySelector('.resource-tile .status-warning') && !!document.querySelector('.resource-tile .status-good')");
      assert.equal(await evaluate("document.querySelector('.resource-tile .status-warning').textContent.trim()"), "");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.resource-tile .status-warning .status-dot')).backgroundColor"), "rgb(230, 175, 56)");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.resource-tile .status-good .status-dot')).backgroundColor"), "rgb(60, 173, 128)");
      await call("Page.bringToFront");
      await evaluate("document.querySelector('.resource-tile .status-warning').focus()");
      await until("!!document.querySelector('[role=tooltip]') && document.querySelector('[role=tooltip]').textContent.includes('disk · permission_denied')");
      await capture("collector-details");
      await evaluate("document.querySelector('.resource-tile .status-warning').blur()");
      await until("!document.querySelector('[role=tooltip]')");
      const trigger = await evaluate("(()=>{const r=document.querySelector('.resource-tile .status-warning').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
      await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...trigger });
      await until("!!document.querySelector('[role=tooltip]') && document.querySelector('[role=tooltip]').textContent.includes('permission_denied')");
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
      await until("document.readyState===\'complete\'");
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
      console.log(
        "Verified resource, plugin, interactive persistence and background sampling flows",
      );
    } finally {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ id: 999999, method: "Browser.close" }));
        await delay(500);
      }
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
      await delay(500);
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
  },
);
