import { requireOwner } from '@/app/auth';
import { getPreferences } from '@/db/resources';
import ReleaseCenter from './release-center';
import './releases.css';

export const dynamic = 'force-dynamic';
export default async function ReleasesPage() {
  const owner = await requireOwner();
  const preferences = await getPreferences(owner.userId);
  return <ReleaseCenter theme={preferences.theme} accent={preferences.accent} />;
}
