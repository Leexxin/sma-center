import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { REFERRER_POLICY, validWriteOrigin } from '../deploy/request-origin.mjs';

test('same-origin write protection rejects missing, opaque, forged and cross-site origins', () => {
  const origin = 'http://localhost:8080';
  for (const headers of [{}, {origin:'null'}, {origin:'http://evil.invalid'}, {origin, 'sec-fetch-site':'cross-site'}]) assert.equal(validWriteOrigin(headers, origin), false);
  assert.equal(validWriteOrigin({origin,'sec-fetch-site':'same-origin'},origin),true);
});
test('real browser native forms reproduce old Forbidden and pass the fixed policy', {timeout:30000, skip: process.env.SMA_CENTER_BROWSER_TEST !== '1'}, async () => {
  const requests = [];
  const server = createServer((req,res) => {
    const url = new URL(req.url, 'http://' + req.headers.host);
    if (req.method === 'POST') {
      const status = validWriteOrigin(req.headers,url.origin) ? 200 : 403;
      const result = {status,origin:req.headers.origin ?? null}; requests.push(result);
      res.writeHead(status,{'Content-Type':'text/html'}); res.end('<pre>'+JSON.stringify(result)+'</pre>'); return;
    }
    res.writeHead(200,{'Content-Type':'text/html','Referrer-Policy':url.searchParams.get('policy') || REFERRER_POLICY});
    res.end('<form method="post" action="/submit"><input name="setupCode" value="regression-test"><button>Submit</button></form>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const directory=mkdtempSync(join(tmpdir(),'sma-chrome-origin-'));
  const chrome=spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--user-data-dir='+directory,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
  let socket;
  try {
    const file=join(directory,'DevToolsActivePort');
    for(let n=0;n<100&&!existsSync(file);n++)await delay(100);
    assert.ok(existsSync(file),'headless Chrome started');
    const port=readFileSync(file,'utf8').split('\n')[0];
    const tab=await(await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();
    socket=new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let id=0;const pending=new Map();
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);if(message.error)reject(new Error(message.error.message));else resolve(message.result);}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
    await call('Page.enable');
    for(const [policy,expected] of [['no-referrer',403],[REFERRER_POLICY,200]]) {
      await call('Page.navigate',{url:origin+'/?policy='+policy});
      let ready=false;
      for(let n=0;n<100;n++){const result=await call('Runtime.evaluate',{expression:'Boolean(document.querySelector("form"))',returnByValue:true});if(result.result.value){ready=true;break;}await delay(50);}
      assert.ok(ready,'native form loaded');
      const before=requests.length;
      await call('Runtime.evaluate',{expression:'document.querySelector("form").requestSubmit()'});
      for(let n=0;n<100&&requests.length===before;n++)await delay(50);
      assert.equal(requests.length,before+1,'native POST reached server');
      assert.equal(requests.at(-1).status,expected,policy);
      assert.equal(requests.at(-1).origin,policy==='no-referrer'?'null':origin);
      console.log(`${policy}: browser Origin=${requests.at(-1).origin}, HTTP ${expected}`);
    }
  } finally {socket?.close();chrome.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));}
});
