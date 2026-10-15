import { createHmac, createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let value = 0, bits = 0, result = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function unbase32(secret) {
  let value = 0, bits = 0; const result = [];
  for (const char of secret) { const digit = alphabet.indexOf(char); if (digit < 0) throw new Error('Invalid TOTP secret'); value = (value << 5) | digit; bits += 5; if (bits >= 8) { result.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(result);
}
export function totp(secret, counter, digits = 6) {
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', unbase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function matchTotp(secret, code, now = Date.now(), last = -1) {
  if (!/^\d{6}$/.test(code || '')) return null;
  const current = Math.floor(now / 30000);
  for (const delta of [0, -1, 1]) { const counter = current + delta; if (counter >= 0 && counter > last && equal(totp(secret, counter), code)) return counter; }
  return null;
}
export class TotpAuth {
  constructor(directory, signingSecret, now = () => Date.now()) {
    this.directory = directory; this.now = now; this.key = signingSecret;
    this.encryptionKey = createHash('sha256').update('sma-center-totp:' + signingSecret).digest();
    this.file = join(directory, 'totp-auth.json'); this.setupFile = join(directory, 'setup-code.txt');
    mkdirSync(directory, { recursive: true });
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : null;
    if (!this.state) this.reset();
  }
  save() { const temporary = this.file + '.tmp'; writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 }); renameSync(temporary, this.file); }
  reset() {
    const code = randomBytes(24).toString('base64url');
    this.state = { version: 1, bound: false, ownerId: 'selfhost:admin', ttlSeconds: 43200, generation: randomBytes(16).toString('hex'), setupHash: hash(code), pending: null, lastCounter: -1, failures: 0, blockedUntil: 0 };
    writeFileSync(this.setupFile, code + '\n', { mode: 0o600 }); this.save();
  }
  encrypt(secret) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from('sma-center-totp-v1'));
    return { iv: iv.toString('hex'), ciphertext: Buffer.concat([cipher.update(secret), cipher.final()]).toString('hex'), tag: cipher.getAuthTag().toString('hex') };
  }
  decrypt(value) {
    const cipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(value.iv, 'hex'));
    cipher.setAAD(Buffer.from('sma-center-totp-v1')); cipher.setAuthTag(Buffer.from(value.tag, 'hex'));
    return Buffer.concat([cipher.update(Buffer.from(value.ciphertext, 'hex')), cipher.final()]).toString();
  }
  limited() { return this.state.blockedUntil > this.now(); }
  fail() {
    if (this.state.blockedUntil && this.state.blockedUntil <= this.now()) { this.state.failures = 0; this.state.blockedUntil = 0; }
    if (++this.state.failures >= 10) this.state.blockedUntil = this.now() + 10 * 60000;
    this.save();
  }
  success() { this.state.failures = 0; this.state.blockedUntil = 0; }
  authorizeSetup(code) {
    if (this.state.bound || this.limited()) return null;
    if (!equal(hash(code || ''), this.state.setupHash)) { this.fail(); return null; }
    const nonce = randomBytes(32).toString('base64url');
    this.state.pending = { cookieHash: hash(nonce), secret: this.encrypt(base32(randomBytes(20))), expires: this.now() + 10 * 60000 };
    this.success(); this.save(); return nonce;
  }
  pending(nonce) {
    const pending = this.state.pending;
    if (this.state.bound || !pending || pending.expires <= this.now() || !equal(hash(nonce || ''), pending.cookieHash)) return null;
    return this.decrypt(pending.secret);
  }
  confirmSetup(nonce, code) {
    if (this.limited()) return null;
    const secret = this.pending(nonce); if (!secret) return null;
    const counter = matchTotp(secret, code, this.now());
    if (counter === null) { this.fail(); return null; }
    this.state.secret = this.state.pending.secret; this.state.bound = true; this.state.lastCounter = counter;
    this.state.pending = null; this.state.setupHash = null; this.state.generation = randomBytes(16).toString('hex'); this.success(); this.save();
    if (existsSync(this.setupFile)) unlinkSync(this.setupFile);
    return this.issueSession();
  }
  login(code) {
    if (!this.state.bound || this.limited()) return null;
    const counter = matchTotp(this.decrypt(this.state.secret), code, this.now(), this.state.lastCounter);
    if (counter === null) { this.fail(); return null; }
    this.state.lastCounter = counter; this.success(); this.save(); return this.issueSession();
  }
  sign(value) { return createHmac('sha256', this.key).update('totp-session-v1.' + value).digest('base64url'); }
  issueSession() {
    if (!this.state.bound) throw new Error('2FA_NOT_BOUND');
    const issued = this.now();
    const payload = Buffer.from(JSON.stringify({ version: 1, issued, expires: issued + this.state.ttlSeconds * 1000, generation: this.state.generation, nonce: randomBytes(16).toString('hex') })).toString('base64url');
    return payload + '.' + this.sign(payload);
  }
  session(token) {
    if (!this.state.bound || typeof token !== 'string' || token.length > 2048) return null;
    try {
      const [payload, signature, extra] = token.split('.');
      if (extra || !equal(this.sign(payload), signature)) return null;
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (value.version !== 1 || value.generation !== this.state.generation || !Number.isFinite(value.issued) || !Number.isFinite(value.expires) || value.issued > this.now() || value.expires <= value.issued || !/^[a-f0-9]{32}$/.test(value.nonce)) return null;
      const expires = Math.min(value.expires, value.issued + this.state.ttlSeconds * 1000);
      return expires > this.now() ? { expires, ownerId: this.state.ownerId } : null;
    } catch { return null; }
  }
  setDuration(minutes) {
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 43200) throw new Error('登录有效期应为 5 分钟到 30 天。');
    this.state.ttlSeconds = minutes * 60; this.save();
  }
  logout() { this.state.generation = randomBytes(16).toString('hex'); this.save(); }
}
