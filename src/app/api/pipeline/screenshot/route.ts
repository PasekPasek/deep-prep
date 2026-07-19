import { db } from '@/lib/db';
import { badRequest, json, serverError, triggerNextStep } from '@/lib/http';
import { createRun } from '@/orchestrator/state';

/**
 * POST /api/pipeline/screenshot — multipart upload of an offer screenshot.
 *
 * The image goes into the private bucket; the offer stores only the storage path.
 * The extract step mints a short-lived signed URL when it actually needs the image,
 * so nothing about the screenshot is ever publicly reachable.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest('expected multipart form data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return badRequest('missing file field');
  if (!ALLOWED_TYPES.has(file.type)) {
    return badRequest(`unsupported type ${file.type} — use PNG, JPEG or WebP`);
  }
  if (file.size === 0) return badRequest('empty file');
  if (file.size > MAX_BYTES) return badRequest('file exceeds 10 MiB');

  try {
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await db()
      .storage.from('screenshots')
      .upload(path, file, { contentType: file.type });
    if (uploadError) return serverError(`upload failed: ${uploadError.message}`);

    const { data: offer, error: offerError } = await db()
      .from('offers')
      .insert({ input_kind: 'screenshot', raw_input: path })
      .select('id')
      .single();
    if (offerError) return serverError(`could not create offer: ${offerError.message}`);

    const run = await createRun(offer.id);
    triggerNextStep(run.id, new URL(request.url).origin);

    return json({ offerId: offer.id, runId: run.id, status: run.status }, 201);
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}
