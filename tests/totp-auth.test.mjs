import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TotpAuth, base32, totp, matchTotp } from '../deploy/totp-auth.mjs';
const make = () => {
  const directory = mkdtempSync(join(tmpdir(), 'sma-totp-test-'));
  let now = 1234567890000;
  const auth = new TotpAuth(directory, 'a'.repeat(64), () => now);
  return { auth, directory, advance: ms => { now += ms; }, time: () => now, setup: () => readFileSync(join(directory, 'setup-code.txt'), 'utf8').trim() };
};
const bind = fixture => {
  const nonce = fixture.auth.authorizeSetup(fixture.setup());
  const secret = fixture.auth.pending(nonce);
  const token = fixture.auth.confirmSetup(nonce, totp(secret, Math.floor(fixture.time() / 30000)));
  return { nonce, secret, token };
};
test('TOTP matches all RFC 6238 SHA1 test vectors', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  for (const [seconds, expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']]) assert.equal(totp(secret, Math.floor(seconds / 30), 8), expected);
});
test('unbound panel cannot get a session and setup requires operator code and private browser nonce', () => {
  const f = make(); assert.equal(f.auth.session('anything'), null); assert.throws(() => f.auth.issueSession());
  assert.equal(f.auth.authorizeSetup('wrong'), null); assert.equal(f.auth.login('123456'), null);
  const nonce = f.auth.authorizeSetup(f.setup());
  assert.equal(f.auth.pending('other-browser'), null);
  assert.equal(f.auth.confirmSetup('other-browser', '123456'), null);
  assert.ok(f.auth.pending(nonce));
  assert.equal(f.auth.confirmSetup(nonce, 'not-code'), null); assert.equal(f.auth.state.bound, false);
});
test('binding activates only after valid dynamic code, encrypts seed at rest and consumes setup authorization', () => {
  const f = make(), oldSetup = f.setup(), { nonce, secret, token } = bind(f);
  assert.ok(f.auth.session(token)); assert.equal(f.auth.state.bound, true);
  assert.equal(f.auth.pending(nonce), null); assert.equal(f.auth.authorizeSetup(oldSetup), null);
  assert.equal(existsSync(join(f.directory, 'setup-code.txt')), false);
  assert.ok(!readFileSync(join(f.directory, 'totp-auth.json'), 'utf8').includes(secret));
});
test('used TOTP cannot be replayed and new time-step code can log in', () => {
  const f = make(), { secret } = bind(f);
  const code = totp(secret, Math.floor(f.time() / 30000)); assert.equal(f.auth.login(code), null);
  f.advance(30000); const next = totp(secret, Math.floor(f.time() / 30000));
  assert.ok(f.auth.login(next)); assert.equal(f.auth.login(next), null);
  assert.equal(matchTotp(secret, '12345', f.time()), null);
});
test('sessions reject tampering, old account cookies, future-issued claims, and expire', () => {
  const f = make(), { token } = bind(f);
  assert.equal(f.auth.session(token + 'tampered'), null);
  assert.equal(f.auth.session(Buffer.from('{"id":"selfhost:admin"}').toString('base64url') + '.old'), null);
  const [payload] = token.split('.'), future = JSON.parse(Buffer.from(payload, 'base64url'));
  future.issued = f.time() + 1;
  const encoded = Buffer.from(JSON.stringify(future)).toString('base64url');
  assert.equal(f.auth.session(encoded + '.' + f.auth.sign(encoded)), null);
  f.advance(43200000); assert.equal(f.auth.session(token), null);
});
test('duration shortening applies to old sessions; duration, replay protection and sessions survive restart', () => {
  const f = make(), { token, secret } = bind(f);
  f.auth.setDuration(5);
  const restarted = new TotpAuth(f.directory, 'a'.repeat(64), f.time);
  assert.ok(restarted.session(token)); assert.equal(restarted.state.ttlSeconds, 300);
  assert.equal(restarted.login(totp(secret, Math.floor(f.time() / 30000))), null);
  f.advance(300001); assert.equal(restarted.session(token), null);
  for (const n of [0,4,43201,NaN,Infinity,6.5]) assert.throws(() => f.auth.setDuration(n));
});
test('logout and operator reset revoke existing sessions; reset requires rebinding', () => {
  const f = make(), { token } = bind(f); f.auth.logout(); assert.equal(f.auth.session(token), null);
  const newer = f.auth.issueSession(); f.auth.reset();
  assert.equal(f.auth.session(newer), null); assert.equal(f.auth.state.bound, false); assert.ok(f.setup());
});
test('rate limits persist over restart and enrollment authorization expires', () => {
  const f = make(); const nonce = f.auth.authorizeSetup(f.setup()); f.advance(600001); assert.equal(f.auth.pending(nonce), null);
  for (let i = 0; i < 10; i++) f.auth.authorizeSetup('wrong');
  assert.ok(f.auth.limited());
  const restarted = new TotpAuth(f.directory, 'a'.repeat(64), f.time);
  assert.ok(restarted.limited()); assert.equal(restarted.authorizeSetup(f.setup()), null);
  f.advance(600001); assert.ok(restarted.authorizeSetup(f.setup()));
});
