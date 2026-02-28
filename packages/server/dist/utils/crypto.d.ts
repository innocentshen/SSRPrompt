/**
 * Encrypt a plaintext string using AES-256-GCM
 * @param plaintext The string to encrypt
 * @returns Encrypted string in format: iv:authTag:encrypted (all hex)
 */
export declare function encrypt(plaintext: string): string;
/**
 * Decrypt a ciphertext string encrypted with encrypt()
 * @param ciphertext The encrypted string in format: iv:authTag:encrypted
 * @returns Decrypted plaintext string
 */
export declare function decrypt(ciphertext: string): string;
/**
 * Check if a string looks like an encrypted value
 */
export declare function isEncrypted(value: string): boolean;
//# sourceMappingURL=crypto.d.ts.map