import { Provider } from '@prisma/client';
import { CreateProviderInput, UpdateProviderInput, TestConnectionInput, DiscoverProviderModelsInput } from '@ssrprompt/shared';
interface DiscoveredModel {
    id: string;
    name: string;
    owned_by?: string;
    maxContextLength?: number;
}
export interface TestConnectionResult {
    success: boolean;
    message: string;
    latencyMs?: number;
}
export declare class ProvidersService {
    private ensureSystemUserExists;
    /**
     * Get all providers for a user
     */
    findAll(userId: string): Promise<Provider[]>;
    /**
     * Get provider by ID
     */
    findById(userId: string, id: string): Promise<Provider | null>;
    /**
     * Get provider with models
     */
    findWithModels(userId: string, id: string): Promise<({
        type: import("@prisma/client").$Enums.ProviderType;
        name: string;
        userId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        isSystem: boolean;
        apiKey: string;
        baseUrl: string | null;
        enabled: boolean;
    } & {
        models: unknown[];
    }) | null>;
    /**
     * Create a new provider
     */
    create(userId: string, data: CreateProviderInput, isAdmin?: boolean): Promise<Provider>;
    /**
     * Update a provider
     */
    update(userId: string, id: string, data: UpdateProviderInput, isAdmin?: boolean): Promise<Provider>;
    /**
     * Delete a provider and all its models
     */
    delete(userId: string, id: string, isAdmin?: boolean): Promise<Provider>;
    /**
     * Test connection to a provider API
     */
    testConnection(data: TestConnectionInput): Promise<TestConnectionResult>;
    /**
     * Discover models supported by a provider (remote model list).
     * Uses saved provider credentials by default, but allows temporary overrides from the UI.
     */
    discoverModels(userId: string, providerId: string, input: DiscoverProviderModelsInput, requestOrigin?: string): Promise<DiscoveredModel[]>;
}
export declare const providersService: ProvidersService;
export {};
//# sourceMappingURL=providers.service.d.ts.map