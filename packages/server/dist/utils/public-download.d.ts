import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
export type DownloadPublicUrlOptions = {
    maxBytes: number;
    timeoutMs: number;
    maxRedirects: number;
    _lookupFn?: (hostname: string) => Promise<LookupAddress[]>;
    _requestFn?: (url: URL, resolvedHost: ResolvedPublicHost, timeoutMs: number) => Promise<IncomingMessage>;
};
type ResolvedPublicHost = {
    address: string;
    family: 4 | 6;
};
export declare function downloadPublicUrl(urlValue: string, options: DownloadPublicUrlOptions): Promise<{
    finalUrl: string;
    buffer: Buffer;
    contentType: string | null;
    filename: string | null;
}>;
export {};
//# sourceMappingURL=public-download.d.ts.map