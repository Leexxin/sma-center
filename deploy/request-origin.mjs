// no-referrer makes native form submissions opaque (Origin: null).
export const REFERRER_POLICY = 'same-origin';
export function validWriteOrigin(headers, expectedOrigin) {
  return headers.origin === expectedOrigin && headers['sec-fetch-site'] !== 'cross-site';
}
