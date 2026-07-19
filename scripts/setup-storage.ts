/**
 * One-time: create the private screenshots bucket. Idempotent — safe to re-run.
 * Buckets are not SQL objects, so this cannot live in a migration.
 */
import { db } from '../src/lib/db';

async function main() {
  const storage = db().storage;
  const { data: buckets } = await storage.listBuckets();
  if (buckets?.some((b) => b.name === 'screenshots')) {
    console.log('bucket "screenshots" already exists');
    return;
  }
  const { error } = await storage.createBucket('screenshots', {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024, // 10 MiB — generous for a phone screenshot
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  });
  if (error) throw new Error(error.message);
  console.log('created private bucket "screenshots" (10 MiB cap, png/jpeg/webp only)');
}
main().catch((e) => { console.error(e); process.exit(1); });
