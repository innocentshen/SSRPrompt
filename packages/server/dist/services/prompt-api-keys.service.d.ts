import { type CreatePromptApiKeyInput, type CreatePromptApiKeyResult, type PromptApiKey } from '@ssrprompt/shared';
type PromptApiKeyAuthResult = {
    keyId: string;
    userId: string;
};
export declare class PromptApiKeysService {
    list(userId: string): Promise<PromptApiKey[]>;
    create(userId: string, input: CreatePromptApiKeyInput): Promise<CreatePromptApiKeyResult>;
    revoke(userId: string, id: string): Promise<PromptApiKey>;
    authenticate(apiKeyRaw: string): Promise<PromptApiKeyAuthResult>;
}
export declare const promptApiKeysService: PromptApiKeysService;
export {};
//# sourceMappingURL=prompt-api-keys.service.d.ts.map