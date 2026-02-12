export interface PromptApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptApiKeyDto {
  name: string;
  expiresAt?: string | null;
}

export interface CreatePromptApiKeyResult {
  key: PromptApiKey;
  apiKey: string;
}
