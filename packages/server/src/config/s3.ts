import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { AppError } from '@ssrprompt/shared';
import { env } from './env.js';

let s3Client: S3Client | null = null;

export function isS3Configured(): boolean {
  return !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

export function getS3Client(): { client: S3Client; bucket: string } {
  if (!isS3Configured()) {
    throw new AppError(500, 'INTERNAL_ERROR', 'S3 storage is not configured');
  }

  const endpoint = env.S3_ENDPOINT!;
  const bucket = env.S3_BUCKET!;
  const accessKeyId = env.S3_ACCESS_KEY_ID!;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY!;

  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_REGION,
      endpoint,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  return { client: s3Client, bucket };
}

export async function checkS3Connection(options?: { timeoutMs?: number }): Promise<void> {
  if (!isS3Configured()) {
    console.log('[S3] Not configured; skipping MinIO/S3 check.');
    return;
  }

  const { client, bucket } = getS3Client();
  const endpoint = env.S3_ENDPOINT!;
  const timeoutMs = options?.timeoutMs ?? 5000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: controller.signal });
    console.log(`[S3] OK (bucket: ${bucket}, endpoint: ${endpoint})`);
  } catch (error) {
    const errorRecord =
      error && typeof error === 'object' ? (error as { name?: unknown }) : null;
    const name = errorRecord?.name ? String(errorRecord.name) : 'S3Error';
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[S3] ERROR (bucket: ${bucket}, endpoint: ${endpoint}): ${name}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}
