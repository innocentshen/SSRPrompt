export type ZipReaderLimits = {
    maxEntries: number;
    maxTotalUncompressedBytes: number;
};
export declare class ZipReader {
    private readonly zipFile;
    private readonly entriesByPath;
    private constructor();
    static fromBuffer(buffer: Buffer, limits: ZipReaderLimits): Promise<ZipReader>;
    listPaths(): string[];
    /**
     * Best-effort find by basename (case-insensitive).
     * Useful when users put `import.xlsx` inside a folder.
     */
    findByBasename(basename: string): string | null;
    has(path: string): boolean;
    readBuffer(path: string, maxBytes: number): Promise<Buffer>;
    close(): void;
}
//# sourceMappingURL=zip-reader.d.ts.map