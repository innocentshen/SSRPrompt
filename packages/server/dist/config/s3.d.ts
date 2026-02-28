import { S3Client } from '@aws-sdk/client-s3';
export declare function isS3Configured(): boolean;
export declare function getS3Client(): {
    client: S3Client;
    bucket: string;
};
export declare function checkS3Connection(options?: {
    timeoutMs?: number;
}): Promise<void>;
//# sourceMappingURL=s3.d.ts.map