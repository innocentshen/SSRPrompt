import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@ssrprompt/shared';
import { prisma } from '../config/database.js';
import { chatController } from './chat.controller.js';
const AttachmentSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('image_url'),
        image_url: z.object({
            url: z.string().min(1),
        }),
    }),
    z.object({
        type: z.literal('file'),
        file: z.object({
            filename: z.string().min(1),
            file_data: z.string().min(1),
        }),
    }),
    z.object({
        type: z.literal('file_ref'),
        file_ref: z.object({
            fileId: z.string().uuid(),
        }),
    }),
]);
const VersionSelectorSchema = z.union([
    z.literal('latest'),
    z.number().int().positive(),
    z
        .string()
        .regex(/^\d+$/)
        .transform((value) => Number.parseInt(value, 10)),
]);
const InvokePromptSchema = z.object({
    input: z.string().optional().default(''),
    variables: z.record(z.unknown()).optional().default({}),
    attachments: z.array(AttachmentSchema).optional().default([]),
    version: VersionSelectorSchema.optional(),
    modelId: z.string().uuid().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().positive().optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    stream: z.boolean().optional().default(false),
    saveTrace: z.boolean().optional().default(true),
    conversationId: z.string().trim().min(1).max(128).optional(),
    historyLimit: z.number().int().min(0).max(50).optional().default(12),
    reasoning: z
        .object({
        enabled: z.boolean(),
        effort: z.enum(['default', 'none', 'low', 'medium', 'high']).optional(),
    })
        .optional(),
    responseFormat: z.record(z.unknown()).optional(),
    fileProcessing: z.enum(['auto', 'vision', 'ocr', 'none']).optional(),
    ocrProvider: z.enum(['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru']).optional(),
});
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toStringValue(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function containsInputPlaceholder(text) {
    return /\{\{\s*input\s*\}\}/.test(text);
}
function renderTemplateText(template, values) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}/g, (_match, key) => values[key] ?? '');
}
function parseMessagesFromContent(content) {
    if (!content)
        return [];
    try {
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed))
            return [];
        const messages = parsed
            .filter((item) => isRecord(item))
            .filter((item) => item.role === 'system' || item.role === 'user' || item.role === 'assistant')
            .filter((item) => typeof item.content === 'string')
            .map((item) => ({ role: item.role, content: item.content }));
        return messages;
    }
    catch {
        return [];
    }
}
function parsePromptMessages(messages, content) {
    if (Array.isArray(messages) && messages.length > 0) {
        const normalized = messages
            .filter((item) => isRecord(item))
            .filter((item) => item.role === 'system' || item.role === 'user' || item.role === 'assistant')
            .filter((item) => typeof item.content === 'string')
            .map((item) => ({ role: item.role, content: item.content }));
        if (normalized.length > 0)
            return normalized;
    }
    return parseMessagesFromContent(content);
}
function parsePromptVariables(variables) {
    if (!Array.isArray(variables))
        return [];
    return variables
        .filter((item) => isRecord(item))
        .filter((item) => typeof item.name === 'string' && item.name.trim().length > 0)
        .map((item) => ({
        name: item.name.trim(),
        default_value: typeof item.default_value === 'string' ? item.default_value : undefined,
    }));
}
function toAttachmentPart(attachment) {
    if (attachment.type === 'image_url') {
        return { type: 'image_url', image_url: { url: attachment.image_url.url } };
    }
    if (attachment.type === 'file') {
        return {
            type: 'file',
            file: {
                filename: attachment.file.filename,
                file_data: attachment.file.file_data,
            },
        };
    }
    return {
        type: 'file_ref',
        file_ref: {
            fileId: attachment.file_ref.fileId,
        },
    };
}
function toResponseFormat(outputSchema) {
    if (!isRecord(outputSchema))
        return undefined;
    const name = typeof outputSchema.name === 'string' && outputSchema.name.trim().length > 0
        ? outputSchema.name
        : 'response';
    const schema = outputSchema.schema;
    if (!isRecord(schema))
        return undefined;
    const jsonSchema = { name, schema };
    if (typeof outputSchema.description === 'string' && outputSchema.description.trim().length > 0) {
        jsonSchema.description = outputSchema.description;
    }
    if (typeof outputSchema.strict === 'boolean') {
        jsonSchema.strict = outputSchema.strict;
    }
    return {
        type: 'json_schema',
        json_schema: jsonSchema,
    };
}
function numberOrUndefined(value) {
    return typeof value === 'number' ? value : undefined;
}
function resolveReasoning(value) {
    if (!isRecord(value) || typeof value.enabled !== 'boolean')
        return undefined;
    const effort = value.effort;
    if (effort === undefined)
        return { enabled: value.enabled };
    if (effort === 'default' || effort === 'none' || effort === 'low' || effort === 'medium' || effort === 'high') {
        return { enabled: value.enabled, effort };
    }
    return { enabled: value.enabled };
}
function extractLastUserMessage(metadata, fallbackInput) {
    if (isRecord(metadata) && Array.isArray(metadata.messages)) {
        for (let i = metadata.messages.length - 1; i >= 0; i -= 1) {
            const item = metadata.messages[i];
            if (!isRecord(item))
                continue;
            if (item.role !== 'user')
                continue;
            if (typeof item.content === 'string' && item.content.trim().length > 0) {
                return item.content.trim();
            }
        }
    }
    const input = fallbackInput.trim();
    return input.length > 0 ? input : null;
}
async function loadConversationTurns(userId, promptId, conversationId, limit) {
    if (!conversationId || limit <= 0)
        return [];
    const traces = await prisma.trace.findMany({
        where: {
            userId,
            promptId,
            source: 'api',
            status: 'success',
            metadata: {
                path: ['chatRunId'],
                equals: conversationId,
            },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
            input: true,
            output: true,
            metadata: true,
        },
    });
    const turns = [];
    for (const trace of traces.reverse()) {
        const user = extractLastUserMessage(trace.metadata, trace.input);
        if (!user)
            continue;
        const assistant = typeof trace.output === 'string' && trace.output.trim().length > 0 ? trace.output : undefined;
        turns.push({ user, assistant });
    }
    return turns;
}
function mergeConversationHistory(currentMessages, turns) {
    if (turns.length === 0)
        return currentMessages;
    const historyMessages = [];
    for (const turn of turns) {
        historyMessages.push({ role: 'user', content: turn.user });
        if (turn.assistant) {
            historyMessages.push({ role: 'assistant', content: turn.assistant });
        }
    }
    const hasStandaloneCurrentUser = currentMessages.length > 0 && currentMessages[currentMessages.length - 1]?.role === 'user';
    const insertAt = hasStandaloneCurrentUser ? currentMessages.length - 1 : currentMessages.length;
    return [...currentMessages.slice(0, insertAt), ...historyMessages, ...currentMessages.slice(insertAt)];
}
async function resolvePromptSnapshot(userId, promptId, requestedVersion) {
    const prompt = await prisma.prompt.findFirst({
        where: { id: promptId, userId },
        select: {
            id: true,
            content: true,
            messages: true,
            variables: true,
            config: true,
            defaultModelId: true,
            currentVersion: true,
            apiEnabled: true,
            apiVersionMode: true,
            apiFixedVersion: true,
        },
    });
    if (!prompt) {
        throw new AppError(404, 'NOT_FOUND', 'Prompt not found');
    }
    if (!prompt.apiEnabled) {
        throw new AppError(403, 'FORBIDDEN', 'Prompt API access is disabled');
    }
    let targetVersion = 'latest';
    if (requestedVersion !== undefined) {
        targetVersion = requestedVersion;
    }
    else if (prompt.apiVersionMode === 'fixed') {
        if (!prompt.apiFixedVersion) {
            throw new AppError(400, 'INVALID_REQUEST', 'Prompt API fixed version is not configured');
        }
        targetVersion = prompt.apiFixedVersion;
    }
    if (targetVersion === 'latest') {
        return {
            promptId: prompt.id,
            content: prompt.content,
            messages: prompt.messages,
            variables: prompt.variables,
            config: prompt.config,
            defaultModelId: prompt.defaultModelId,
            resolvedVersion: prompt.currentVersion,
        };
    }
    const version = await prisma.promptVersion.findUnique({
        where: {
            promptId_version: {
                promptId,
                version: targetVersion,
            },
        },
    });
    if (version) {
        return {
            promptId: prompt.id,
            content: version.content,
            messages: version.messages,
            variables: version.variables,
            config: version.config,
            defaultModelId: version.defaultModelId,
            resolvedVersion: version.version,
        };
    }
    // Backward compatibility: allow current draft when snapshot row is missing.
    if (targetVersion === prompt.currentVersion) {
        return {
            promptId: prompt.id,
            content: prompt.content,
            messages: prompt.messages,
            variables: prompt.variables,
            config: prompt.config,
            defaultModelId: prompt.defaultModelId,
            resolvedVersion: prompt.currentVersion,
        };
    }
    throw new AppError(404, 'NOT_FOUND', `Prompt version ${targetVersion} not found`);
}
function buildMessagesFromPrompt(snapshot, payload) {
    const inputText = payload.input ?? '';
    const promptMessages = parsePromptMessages(snapshot.messages, snapshot.content);
    const templateStrings = promptMessages.length > 0
        ? promptMessages.map((item) => item.content)
        : [snapshot.content ?? ''];
    const inputInjectedByTemplate = templateStrings.some((text) => containsInputPlaceholder(text));
    const variableDefs = parsePromptVariables(snapshot.variables);
    const values = {};
    for (const variable of variableDefs) {
        if (typeof variable.default_value === 'string') {
            values[variable.name] = variable.default_value;
        }
    }
    for (const [key, value] of Object.entries(payload.variables ?? {})) {
        values[key] = toStringValue(value);
    }
    values.input = inputText;
    const renderedMessages = promptMessages.length > 0
        ? promptMessages.map((message) => ({
            role: message.role,
            content: renderTemplateText(message.content, values),
        }))
        : snapshot.content && snapshot.content.trim().length > 0
            ? [{ role: 'system', content: renderTemplateText(snapshot.content, values) }]
            : [];
    const attachmentParts = payload.attachments.map(toAttachmentPart);
    const shouldAppendInputText = inputText.trim().length > 0 && !inputInjectedByTemplate;
    if (shouldAppendInputText || attachmentParts.length > 0) {
        if (attachmentParts.length === 0) {
            renderedMessages.push({ role: 'user', content: inputText });
        }
        else {
            const contentParts = [];
            if (shouldAppendInputText) {
                contentParts.push({ type: 'text', text: inputText });
            }
            contentParts.push(...attachmentParts);
            renderedMessages.push({ role: 'user', content: contentParts });
        }
    }
    if (renderedMessages.length === 0) {
        throw new AppError(400, 'INVALID_REQUEST', 'Prompt content is empty and no input/attachments were provided');
    }
    return renderedMessages;
}
export const openPromptsController = {
    async invoke(req, res) {
        const userId = req.user.userId;
        const promptId = req.params.promptId;
        const payload = InvokePromptSchema.parse(req.body ?? {});
        const hasConversationId = typeof payload.conversationId === 'string' && payload.conversationId.length > 0;
        const conversationId = payload.conversationId ?? randomUUID();
        const snapshot = await resolvePromptSnapshot(userId, promptId, payload.version);
        const config = isRecord(snapshot.config) ? snapshot.config : {};
        const modelId = payload.modelId ?? snapshot.defaultModelId;
        if (!modelId) {
            throw new AppError(400, 'INVALID_REQUEST', 'No model configured for this prompt');
        }
        const historyTurns = hasConversationId
            ? await loadConversationTurns(userId, snapshot.promptId, conversationId, payload.historyLimit)
            : [];
        const baseMessages = buildMessagesFromPrompt(snapshot, payload);
        const messages = mergeConversationHistory(baseMessages, historyTurns);
        const responseFormat = payload.responseFormat ?? toResponseFormat(config.output_schema);
        req.body = {
            modelId,
            messages,
            promptId: snapshot.promptId,
            stream: payload.stream,
            saveTrace: payload.saveTrace,
            temperature: payload.temperature ?? numberOrUndefined(config.temperature),
            top_p: payload.top_p ?? numberOrUndefined(config.top_p),
            max_tokens: payload.max_tokens ?? numberOrUndefined(config.max_tokens),
            frequency_penalty: payload.frequency_penalty ?? numberOrUndefined(config.frequency_penalty),
            presence_penalty: payload.presence_penalty ?? numberOrUndefined(config.presence_penalty),
            reasoning: payload.reasoning ?? resolveReasoning(config.reasoning),
            responseFormat,
            fileProcessing: payload.fileProcessing,
            ocrProvider: payload.ocrProvider,
            chatRunId: conversationId,
        };
        res.setHeader('X-Prompt-Id', snapshot.promptId);
        res.setHeader('X-Prompt-Version', String(snapshot.resolvedVersion));
        res.setHeader('X-Conversation-Id', conversationId);
        res.setHeader('X-Conversation-History-Count', String(historyTurns.length));
        await chatController.completions(req, res);
    },
};
//# sourceMappingURL=open-prompts.controller.js.map