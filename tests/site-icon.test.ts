import test from "node:test";
import assert from "node:assert/strict";
import { collectSiteIcon, iconCandidates } from "../lib/site-icon.ts";
import { normalizeSiteIcon, MAX_ICON_BYTES } from "../lib/site-icon-data.ts";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=", "base64");
const data = `data:image/png;base64,${png.toString('base64')}`;
test("declared icons resolve relative paths, base URLs and entities, ignoring scripts and invalid schemes", () => {
  const urls = iconCandidates(`<base href='/assets/'><link REL='shortcut icon' href='logo.png?a=1&amp;b=2'><link rel=apple-touch-icon href='/apple.png'><link rel=icon href='javascript:bad'><script>"<link rel=icon href='/fake.png'>"</script>`, "https://site.test/console");
  assert.deepEqual(urls, ["https://site.test/assets/logo.png?a=1&b=2", "https://site.test/apple.png", "https://site.test/favicon.ico"]);
  assert.equal(iconCandidates(Array.from({length:20},(_,i)=>`<link rel=icon href='/${i}.png'>`).join(''), 'https://site.test/').at(-1), 'https://site.test/favicon.ico');
});
test("collection embeds the actual declared image and omits credentials on every request", async () => {
  const urls: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    urls.push(String(input)); assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.equal(new Headers(init?.headers).has('cookie'), false);
    return new Response(urls.length === 1 ? '<link rel="icon" href="/assets/logo.png">' : png, { headers: {"Content-Type": urls.length === 1 ? "text/html" : "image/png"} });
  };
  assert.equal(await collectSiteIcon('http://127.0.0.1:8081/console', fake), data);
  assert.deepEqual(urls, ['http://127.0.0.1:8081/console','http://127.0.0.1:8081/assets/logo.png']);
});
test("redirected login pages and bad declarations still fall back to the actual favicon", async () => {
  const fake: typeof fetch = async (input) => {
    const url=String(input);
    if(url.endsWith('/')) return new Response(null, {status:302,headers:{Location:'/login'}});
    if(url.endsWith('/login')) return new Response('<link rel=icon href=/missing.png>');
    if(url.endsWith('/missing.png')) return new Response('Not found',{status:404});
    return new Response(png);
  };
  assert.equal(await collectSiteIcon('https://site.test/',fake),data);
});
test("HTML errors and missing icons do not become images or prevent saving", async () => {
  const fake: typeof fetch = async () => new Response('<html>login required</html>',{headers:{'Content-Type':'image/png'}});
  assert.equal(await collectSiteIcon('https://site.test/',fake),'');
  assert.equal(await collectSiteIcon('https://site.test/',async()=>{throw new Error('offline');}),'');
});
test("oversized streamed and content-length images are rejected", async () => {
  for (const length of [true,false]) {
    const fake: typeof fetch = async input => String(input).endsWith('/favicon.ico')
      ? new Response(Buffer.concat([png,Buffer.alloc(MAX_ICON_BYTES)]), {headers:length?{'Content-Length':String(MAX_ICON_BYTES+png.length)}:{}})
      : new Response('');
    assert.equal(await collectSiteIcon('https://site.test/',fake),'');
  }
});
test("non-HTTP URLs and embedded credentials are rejected, including redirect destinations", async () => {
  for(const url of ['file:///etc/passwd','data:text/html,bad','https://owner:secret@site.test/']) await assert.rejects(collectSiteIcon(url));
  const fake: typeof fetch = async () => new Response(null,{status:302,headers:{Location:'file:///etc/passwd'}});
  assert.equal(await collectSiteIcon('https://site.test/',fake),'');
});
test("only small image data URLs can be persisted or restored", () => {
  assert.equal(normalizeSiteIcon(data),data); assert.equal(normalizeSiteIcon(undefined),'');
  for(const value of ['https://site.test/logo.png','javascript:bad','data:text/html;base64,PHNjcmlwdD4=',data+'?bad',`data:image/png;base64,${'A'.repeat(100000)}`]) assert.throws(()=>normalizeSiteIcon(value));
});
test("simple SVG favicon is supported but active or externally referencing SVG falls back", async () => {
  for(const valid of [true,false]) {
    const svg=valid?'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>':'<svg onload="alert(1)"><script>bad</script></svg>';
    const fake: typeof fetch = async input => String(input).endsWith('/favicon.ico') ? new Response(svg) : new Response('');
    const result=await collectSiteIcon('https://site.test/',fake);
    assert.equal(result.startsWith('data:image/svg+xml;base64,'),valid);
  }
});
