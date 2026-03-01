import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { downloadPublicUrl } from './public-download.js';
function mockResponse(statusCode, headers = {}, body = '') {
    const stream = Readable.from(body ? [Buffer.from(body)] : []);
    const response = stream;
    response.statusCode = statusCode;
    response.headers = headers;
    return response;
}
test('downloadPublicUrl blocks private DNS resolution', async () => {
    await assert.rejects(() => downloadPublicUrl('http://example.com/file.txt', {
        maxBytes: 1024,
        timeoutMs: 500,
        maxRedirects: 1,
        _lookupFn: async () => [{ address: '127.0.0.1', family: 4 }],
        _requestFn: async () => mockResponse(200, { 'content-type': 'text/plain' }, 'never-called'),
    }), /non-public IP/);
});
test('downloadPublicUrl uses pinned resolved address for request', async () => {
    let pinnedAddress = null;
    const result = await downloadPublicUrl('http://example.com/file.txt', {
        maxBytes: 1024,
        timeoutMs: 500,
        maxRedirects: 1,
        _lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        _requestFn: async (_url, resolvedHost) => {
            pinnedAddress = resolvedHost.address;
            return mockResponse(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="a.txt"' }, 'ok');
        },
    });
    assert.equal(pinnedAddress, '93.184.216.34');
    assert.equal(result.buffer.toString('utf-8'), 'ok');
    assert.equal(result.filename, 'a.txt');
});
test('downloadPublicUrl re-validates redirect target host', async () => {
    let requestCount = 0;
    await assert.rejects(() => downloadPublicUrl('http://example.com/file.txt', {
        maxBytes: 1024,
        timeoutMs: 500,
        maxRedirects: 2,
        _lookupFn: async (hostname) => {
            if (hostname === 'example.com')
                return [{ address: '93.184.216.34', family: 4 }];
            if (hostname === 'internal.local')
                return [{ address: '10.0.0.20', family: 4 }];
            return [];
        },
        _requestFn: async () => {
            requestCount += 1;
            return mockResponse(302, { location: 'http://internal.local/secret' });
        },
    }), /non-public IP/);
    assert.equal(requestCount, 1);
});
test('downloadPublicUrl enforces maxBytes from content-length', async () => {
    await assert.rejects(() => downloadPublicUrl('http://example.com/file.txt', {
        maxBytes: 2,
        timeoutMs: 500,
        maxRedirects: 1,
        _lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        _requestFn: async () => mockResponse(200, { 'content-length': '100' }, 'abc'),
    }), /exceeds size limit/);
});
//# sourceMappingURL=public-download.test.js.map