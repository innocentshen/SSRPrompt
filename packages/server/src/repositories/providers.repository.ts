import { Provider, Prisma } from '@prisma/client';
import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto.js';
import { transformResponse } from '../utils/transform.js';

type ProviderDelegate = typeof prisma.provider;

export class ProvidersRepository extends TenantRepository<
  Provider,
  Prisma.ProviderCreateInput,
  Prisma.ProviderUpdateInput,
  ProviderDelegate
> {
  protected delegate = prisma.provider;
  protected entityName = 'Provider';

  /**
   * Find all providers for a user (with decrypted API keys)
   */
  async findAll(userId: string): Promise<Provider[]> {
    const providers = await this.delegate.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        models: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return providers.map((p) => this.decryptProvider(p));
  }

  /**
   * Find provider by ID with decrypted API key
   */
  async findById(userId: string, id: string): Promise<Provider | null> {
    const provider = await super.findById(userId, id);
    return provider ? this.decryptProvider(provider) : null;
  }

  /**
   * Create a new provider (encrypts API key)
   */
  async create(userId: string, data: Omit<Prisma.ProviderCreateInput, 'userId'>): Promise<Provider> {
    const encryptedData = {
      ...data,
      userId,
      apiKey: encrypt(data.apiKey),
    };

    const provider = await this.delegate.create({
      data: encryptedData,
    });

    return this.decryptProvider(provider);
  }

  /**
   * Update a provider (encrypts API key if provided)
   */
  async update(userId: string, id: string, data: Prisma.ProviderUpdateInput): Promise<Provider> {
    // Verify ownership first
    await this.findByIdOrThrow(userId, id);

    const updateData = { ...data };

    // Encrypt API key if being updated
    if (typeof updateData.apiKey === 'string') {
      updateData.apiKey = encrypt(updateData.apiKey);
    }

    const provider = await this.delegate.update({
      where: { id },
      data: updateData,
    });

    return this.decryptProvider(provider);
  }

  /**
   * Find provider with models
   */
  async findWithModels(userId: string, id: string): Promise<(Provider & { models: unknown[] }) | null> {
    const provider = await this.delegate.findUnique({
      where: { id },
      include: {
        models: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!provider) return null;
    if (provider.userId !== userId) {
      throw new Error('Access denied');
    }

    return this.decryptProvider(provider) as Provider & { models: unknown[] };
  }

  /**
   * Helper to decrypt provider API key
   */
  private decryptProvider<T extends Provider>(provider: T): T {
    const result = transformResponse(provider);

    // Decrypt API key if it's encrypted
    if (result.apiKey && isEncrypted(result.apiKey)) {
      try {
        result.apiKey = decrypt(result.apiKey);
      } catch {
        // If decryption fails, return masked key
        result.apiKey = '***decryption-failed***';
      }
    }

    return result;
  }
}

export const providersRepository = new ProvidersRepository();
