// Run offline or on the single center instance. Never pass a client secret in argv.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
const [command, id, name, entry, ...redirects] = process.argv.slice(2);
if (!['add', 'rotate', 'remove'].includes(command) || !/^[a-zA-Z0-9_-]{1,80}$/.test(id || '') || (command === 'add' && (!name || !entry || !redirects.length)) || (command !== 'add' && name)) throw new Error('Usage: node deploy/sso-client.mjs add ID NAME ENTRY_URL CALLBACK_URL [...CALLBACK_URL] | rotate ID | remove ID');
const directory = process.env.SMA_CENTER_DATA_DIR || new URL('../.sma-center-data/', import.meta.url).pathname;
const file = process.env.SMA_CENTER_SSO_CLIENTS_FILE || join(directory, 'oidc-clients.json');
mkdirSync(dirname(file), { recursive: true });
const clients = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const at = clients.findIndex(c => c.client_id === id);
if (command === 'add' && at >= 0) throw new Error('Client exists; use rotate explicitly');
if (command !== 'add' && at < 0) throw new Error('Client not found');
function url(value) {
  const u = new URL(value);
  if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) || u.username || u.password || u.hash) throw new Error('Use HTTPS (HTTP loopback only), without credentials or fragment');
  return u;
}
if (command === 'add') {
  url(entry); for (const redirect of redirects) url(redirect);
  if (!redirects.some(r => new URL(r).origin === new URL(entry).origin)) throw new Error('Entry must share a callback origin');
  if (clients.length >= 100 || redirects.length > 20) throw new Error('Client limit exceeded');
}
if (command === 'remove') clients.splice(at, 1);
else {
  mkdirSync(directory, { recursive: true });
  const secret = randomBytes(32).toString('base64url');
  const secretFile = join(directory, `oidc-client-${id}-${randomBytes(6).toString('hex')}.secret`);
  writeFileSync(secretFile, secret + '\n', { mode: 0o600, flag: 'wx' });
  const secret_sha256 = createHash('sha256').update(secret).digest('hex');
  if (command === 'add') clients.push({ client_id: id, name, entry_url: entry, redirect_uris: redirects, secret_sha256 });
  else clients[at].secret_sha256 = secret_sha256;
  console.log(`Client secret saved once to ${secretFile}; transfer securely to the application, then delete this delivery file.`);
}
const temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
try { writeFileSync(temporary, JSON.stringify(clients, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, file); }
catch (error) { if (existsSync(temporary)) unlinkSync(temporary); throw error; }
console.log(`SSO client ${command}: ${id}. Configuration is reloaded on the next request.`);
