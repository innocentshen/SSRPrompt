import { AppError } from '@ssrprompt/shared';
import ipaddr from 'ipaddr.js';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import http from 'node:http';
import https from 'node:https';

export type DownloadPublicUrlOptions = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  _lookupFn?: (hostname: string) => Promise<LookupAddress[]>;
  _requestFn?: (
    url: URL,
    resolvedHost: ResolvedPublicHost,
    timeoutMs: number
  ) => Promise<IncomingMessage>;
};

type ResolvedPublicHost = {
  address: string;
  family: 4 | 6;
};

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseContentLength(headers: IncomingHttpHeaders): number | null {
  const header = normalizeHeaderValue(headers['content-length']);
  if (!header) return null;
  const parsed = Number(header);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function isBlockedIp(ip: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    const range = addr.range();
    if (range === 'unicast') return false;
    // Treat everything else as blocked (private/loopback/linkLocal/etc.)
    return true;
  } catch {
    return true;
  }
}

function getIpFamily(ip: string): 4 | 6 {
  const addr = ipaddr.parse(ip);
  return addr.kind() === 'ipv6' ? 6 : 4;
}

async function resolvePublicHostname(
  hostname: string,
  lookupFn: (hostname: string) => Promise<LookupAddress[]>
): Promise<ResolvedPublicHost> {
  // If hostname is an IP literal, validate directly and pin to it.
  if (ipaddr.isValid(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'URL host is not allowed');
    }
    return { address: hostname, family: getIpFamily(hostname) };
  }

  const results = await lookupFn(hostname).catch(() => []);
  if (!results || results.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'URL host cannot be resolved');
  }

  for (const res of results) {
    if (isBlockedIp(res.address)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'URL host resolves to a non-public IP');
    }
  }

  const selected = results[0];
  return {
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
  };
}

function assertAllowedUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Only http/https URLs are allowed');
  }
  if (url.username || url.password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'URL credentials are not allowed');
  }
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  // Very small parser: try filename* first, then filename.
  const filenameStar = header.match(/filename\*\s*=\s*([^']*)''([^;]+)/i);
  if (filenameStar && filenameStar[2]) {
    try {
      return decodeURIComponent(filenameStar[2].trim());
    } catch {
      return filenameStar[2].trim();
    }
  }
  const filename = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (filename && filename[1]) return filename[1].trim();
  return null;
}

async function readIncomingMessageToBuffer(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = parseContentLength(response.headers);
  if (contentLength !== null && contentLength > maxBytes) {
    response.resume();
    throw new AppError(413, 'VALIDATION_ERROR', `Remote file exceeds size limit (${maxBytes} bytes)`);
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of response) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
    total += buf.length;
    if (total > maxBytes) {
      response.destroy();
      throw new AppError(413, 'VALIDATION_ERROR', `Remote file exceeds size limit (${maxBytes} bytes)`);
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

async function requestWithPinnedAddress(
  url: URL,
  resolvedHost: ResolvedPublicHost,
  timeoutMs: number
): Promise<IncomingMessage> {
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;

  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        lookup: (_hostname, _options, callback) => callback(null, resolvedHost.address, resolvedHost.family),
        ...(isHttps ? { servername: url.hostname } : {}),
      },
      (response) => {
        clearTimeout(timer);
        resolve(response);
      }
    );

    const timer = setTimeout(() => {
      request.destroy(new Error('__PUBLIC_DOWNLOAD_TIMEOUT__'));
    }, timeoutMs);

    request.on('error', (error: Error) => {
      clearTimeout(timer);
      if (error.message === '__PUBLIC_DOWNLOAD_TIMEOUT__') {
        reject(new AppError(400, 'VALIDATION_ERROR', 'Remote download timed out'));
        return;
      }
      reject(new AppError(400, 'VALIDATION_ERROR', 'Failed to download URL'));
    });

    request.end();
  });
}

export async function downloadPublicUrl(
  urlValue: string,
  options: DownloadPublicUrlOptions
): Promise<{
  finalUrl: string;
  buffer: Buffer;
  contentType: string | null;
  filename: string | null;
}> {
  let current: URL;
  try {
    current = new URL(urlValue);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid URL');
  }

  const timeoutMs = Math.max(1, options.timeoutMs);
  const maxRedirects = Math.max(0, options.maxRedirects);
  const lookupFn = options._lookupFn ?? ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const requestFn = options._requestFn ?? requestWithPinnedAddress;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    assertAllowedUrl(current);
    const resolvedHost = await resolvePublicHostname(current.hostname, lookupFn);
    const response = await requestFn(current, resolvedHost, timeoutMs);
    const statusCode = response.statusCode ?? 0;

    if ([301, 302, 303, 307, 308].includes(statusCode)) {
      const location = normalizeHeaderValue(response.headers.location);
      response.resume();
      if (!location) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Remote redirect without Location header');
      }
      if (redirects >= maxRedirects) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Too many redirects');
      }
      current = new URL(location, current);
      continue;
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new AppError(400, 'VALIDATION_ERROR', `Remote download failed (HTTP ${statusCode})`);
    }

    const buffer = await readIncomingMessageToBuffer(response, options.maxBytes);
    const contentType = normalizeHeaderValue(response.headers['content-type']);
    const filename = parseContentDispositionFilename(normalizeHeaderValue(response.headers['content-disposition']));

    return {
      finalUrl: current.toString(),
      buffer,
      contentType,
      filename,
    };
  }

  throw new AppError(400, 'VALIDATION_ERROR', 'Too many redirects');
}
