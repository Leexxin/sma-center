import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type Owner = { userId: string; displayName: string; email: string; fullName: string | null };
export async function getOwner(): Promise<Owner | null> {
  const requestHeaders = await headers();
  if (requestHeaders.get('sma-center-authenticated') !== 'totp-v1' || requestHeaders.get('sma-center-owner-id') !== 'selfhost:admin') return null;
  // Retain the existing storage identity so SMA ciphertext and saved records remain valid.
  return { userId: 'selfhost:admin', displayName: '个人工作台', email: 'owner@sma-center.local', fullName: null };
}
export async function requireOwner(): Promise<Owner> {
  const owner = await getOwner();
  if (!owner) redirect('/login');
  return owner;
}
