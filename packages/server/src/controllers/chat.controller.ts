import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getModelWithProvider,
  streamChatCompletion,
  chatCompletion,
  type ChatMessage,
} from '../services/chat.service.js';
import { tracesRepository } from '../repositories/traces.repository.js';
import { AppError } from '@ssrprompt/shared';

// Content part schema for vision
const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
    }),
  }),
]);

// Chat message schema
const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.union([z.string(), z.array(ContentPartSchema)]),
});

// Chat completion request schema
const ChatCompletionSchema = z.object({
  modelId: z.string().uuid(),
  messages: z.array(ChatMessageSchema).min(1),
  promptId: z.string().uuid().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().positive().optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stream: z.boolean().optional().default(true),
  saveTrace: z.boolean().optional().default(true),
});

export const chatController = {
  /**
   * POST /chat/completions - Chat completion with streaming
   */
  async completions(req: Request, res: Response): Promise<void> {
    const data = ChatCompletionSchema.parse(req.body);
    const userId = req.user!.userId;

    // Get model with decrypted API key
    const { model, provider, apiKey } = await getModelWithProvider(userId, data.modelId);

    const startTime = Date.now();
    const abortController = new AbortController();

    // Listen for client disconnect
    req.on('close', () => {
      console.log('Client disconnected, aborting LLM request');
      abortController.abort();
    });

    const options = {
      temperature: data.temperature,
      top_p: data.top_p,
      max_tokens: data.max_tokens,
      frequency_penalty: data.frequency_penalty,
      presence_penalty: data.presence_penalty,
    };

    if (data.stream) {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let fullContent = '';
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      try {
        const stream = streamChatCompletion(
          provider,
          model,
          apiKey,
          data.messages as ChatMessage[],
          options,
          abortController.signal
        );

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;

          // Accumulate content
          const deltaContent = chunk.choices?.[0]?.delta?.content;
          if (deltaContent) {
            fullContent += deltaContent;
          }

          // Capture usage if present
          if (chunk.usage) {
            usage = chunk.usage;
          }

          // Send chunk to client
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        res.write('data: [DONE]\n\n');
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.log('LLM request aborted by client');
        } else {
          const appError = error instanceof AppError ? error : new AppError(
            500,
            'PROVIDER_ERROR',
            (error as Error).message
          );
          res.write(`data: ${JSON.stringify({ error: appError })}\n\n`);
        }
      } finally {
        const latencyMs = Date.now() - startTime;

        // Save trace if requested and not aborted
        if (data.saveTrace && !abortController.signal.aborted) {
          try {
            const inputContent = data.messages
              .map((m) => (typeof m.content === 'string' ? m.content : '[complex content]'))
              .join('\n');

            await tracesRepository.create(userId, {
              input: inputContent,
              output: fullContent || null,
              tokensInput: usage.prompt_tokens,
              tokensOutput: usage.completion_tokens,
              latencyMs,
              status: fullContent ? 'success' : 'error',
              prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
              model: { connect: { id: model.id } },
            });
          } catch (traceError) {
            console.error('Failed to save trace:', traceError);
          }
        }

        res.end();
      }
    } else {
      // Non-streaming response
      try {
        const result = await chatCompletion(
          provider,
          model,
          apiKey,
          data.messages as ChatMessage[],
          options
        );

        const latencyMs = Date.now() - startTime;

        // Save trace if requested
        if (data.saveTrace) {
          try {
            const inputContent = data.messages
              .map((m) => (typeof m.content === 'string' ? m.content : '[complex content]'))
              .join('\n');

            await tracesRepository.create(userId, {
              input: inputContent,
              output: result.content,
              tokensInput: result.usage.prompt_tokens,
              tokensOutput: result.usage.completion_tokens,
              latencyMs,
              status: 'success',
              prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
              model: { connect: { id: model.id } },
            });
          } catch (traceError) {
            console.error('Failed to save trace:', traceError);
          }
        }

        res.json({
          data: {
            content: result.content,
            usage: result.usage,
            latencyMs,
          },
        });
      } catch (error) {
        const latencyMs = Date.now() - startTime;

        // Save error trace if requested
        if (data.saveTrace) {
          try {
            const inputContent = data.messages
              .map((m) => (typeof m.content === 'string' ? m.content : '[complex content]'))
              .join('\n');

            await tracesRepository.create(userId, {
              input: inputContent,
              output: null,
              latencyMs,
              status: 'error',
              errorMessage: (error as Error).message,
              prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
              model: { connect: { id: model.id } },
            });
          } catch (traceError) {
            console.error('Failed to save trace:', traceError);
          }
        }

        throw error;
      }
    }
  },
};
