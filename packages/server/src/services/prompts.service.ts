import { Prompt, PromptVersion } from '@prisma/client';
import { promptsRepository, promptVersionsRepository } from '../repositories/prompts.repository.js';
import { CreatePromptInput, UpdatePromptInput, CreateVersionInput } from '@ssrprompt/shared';

export class PromptsService {
  /**
   * Get all prompts for a user (list view)
   */
  async findAll(userId: string): Promise<Partial<Prompt>[]> {
    return promptsRepository.findAllList(userId);
  }

  /**
   * Get prompt by ID with full details
   */
  async findById(userId: string, id: string): Promise<Prompt | null> {
    return promptsRepository.findById(userId, id);
  }

  /**
   * Create a new prompt
   */
  async create(userId: string, data: CreatePromptInput): Promise<Prompt> {
    return promptsRepository.create(userId, {
      name: data.name,
      description: data.description,
      content: data.content,
      variables: data.variables ?? [],
      messages: data.messages ?? [],
      config: data.config ?? {},
      defaultModelId: data.defaultModelId,
    });
  }

  /**
   * Update a prompt
   */
  async update(userId: string, id: string, data: UpdatePromptInput): Promise<Prompt> {
    return promptsRepository.update(userId, id, data);
  }

  /**
   * Delete a prompt
   */
  async delete(userId: string, id: string): Promise<Prompt> {
    return promptsRepository.delete(userId, id);
  }

  /**
   * Update order of multiple prompts
   */
  async updateOrder(userId: string, updates: { id: string; orderIndex: number }[]): Promise<void> {
    return promptsRepository.updateOrder(userId, updates);
  }

  /**
   * Get versions for a prompt
   */
  async getVersions(userId: string, promptId: string): Promise<PromptVersion[]> {
    // Verify ownership
    await promptsRepository.findByIdOrThrow(userId, promptId);
    return promptVersionsRepository.findByPrompt(promptId);
  }

  /**
   * Create a new version
   */
  async createVersion(
    userId: string,
    promptId: string,
    data: CreateVersionInput
  ): Promise<PromptVersion> {
    // Verify ownership
    await promptsRepository.findByIdOrThrow(userId, promptId);

    const nextVersion = await promptsRepository.getNextVersion(promptId);
    return promptVersionsRepository.createVersion(
      promptId,
      nextVersion,
      data.content,
      data.commitMessage
    );
  }

  /**
   * Get a specific version
   */
  async getVersion(
    userId: string,
    promptId: string,
    version: number
  ): Promise<PromptVersion | null> {
    // Verify ownership
    await promptsRepository.findByIdOrThrow(userId, promptId);
    return promptVersionsRepository.findByVersion(promptId, version);
  }
}

export const promptsService = new PromptsService();
