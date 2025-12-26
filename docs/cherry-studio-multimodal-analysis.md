# Cherry Studio 图片和文件处理分析报告

## 项目概述

Cherry Studio 是一个支持多种 AI 服务商的桌面应用（基于 Electron + TypeScript），具有完善的多模态内容处理能力。项目使用 Vercel AI SDK 作为统一的 AI 集成层，支持文本、图片、Office 文档、PDF 等多种输入格式。

## 核心架构设计

### 1. 分层架构

```
应用层消息格式
    ↓
CoreRequest (统一请求格式)
    ↓
RequestTransformer (服务商适配器)
    ↓
服务商特定 SDK 参数
    ↓
API 请求
```

### 2. 关键模块

- **prepareParams**: 参数准备和转换
- **provider**: 服务商适配器
- **middleware**: 请求/响应处理管道
- **legacy/clients**: 各服务商的具体实现

## 文件和图片处理流程

### 消息数据结构

```typescript
// 消息元数据
interface FileMetadata {
  id: string
  name: string
  origin_name: string
  path: string
  size: number
  extension: string
  type: FileTypes  // IMAGE, VIDEO, AUDIO, TEXT, DOCUMENT, OTHER
  created_at: string
  tokens?: number
  purpose?: string

  // 远程文件支持
  remoteFile?: RemoteFile  // Gemini | Mistral | OpenAI
}

// 消息结构
interface Message {
  files?: FileMetadata[]
  images?: string[]  // URLs 或 base64
  metadata?: {
    citations?: Citation[]
    generatedImages?: GenerateImageResponse[]
    // ...
  }
}
```

### 文件处理策略（优雅降级）

```typescript
// 处理优先级
1. 原生格式支持（Native FilePart）
   ↓ 失败或不支持
2. 大文件上传 API（Gemini File API）
   ↓ 失败或不支持
3. 文本内容提取（TextPart）
```

### 图片处理实现

#### 图片转换为 ImagePart

```typescript
// 来源：aiCore/prepareParams/messageConverter.ts
function convertImageBlockToImagePart(imageBlock, model, provider) {
  const { file } = imageBlock

  if (file.path) {
    // 本地文件 -> base64
    const base64Data = await window.api.file.base64Image(file.path)
    return {
      type: 'image',
      image: base64Data,  // base64 格式
      mimeType: file.type === 'image/jpg' ? 'image/jpeg' : file.type
    }
  }

  if (file.url && file.url.startsWith('data:')) {
    // Data URL
    const { mediaType, data } = parseDataUrlMediaType(file.url)
    return {
      type: 'image',
      image: data,  // base64 数据
      mimeType: mediaType
    }
  }

  if (file.url) {
    // 远程 URL
    return {
      type: 'image',
      image: new URL(file.url),  // 保持 URL
      mimeType: file.type
    }
  }
}
```

#### 图片处理工具函数

```typescript
// 来源：utils/image.ts
// Base64 转换
async function convertToBase64(file: File): Promise<string | ArrayBuffer>

// 图片压缩（限制 1MB、300px）
async function compressImage(file: File): Promise<File>

// 格式转换
async function convertImageToPng(image: HTMLImageElement): Promise<Blob>
```

### 文件处理实现

#### FilePart 转换（原生支持）

```typescript
// 来源：aiCore/prepareParams/fileProcessor.ts
async function convertFileBlockToFilePart(fileBlock, model, provider) {
  const { file } = fileBlock
  const fileLimit = getModelFileLimit(model, file.type, provider)

  // 大小验证
  if (file.size > fileLimit) {
    return null
  }

  // 图片处理
  if (file.type === FileTypes.IMAGE) {
    const base64Data = await window.api.file.base64Image(file.path)

    // Anthropic 特殊处理：jpg -> jpeg
    let mimeType = file.extension
    if (provider.id === 'anthropic' && mimeType === 'image/jpg') {
      mimeType = 'image/jpeg'
    }

    return {
      type: 'file',
      mediaType: mimeType,
      data: base64Data,
      filename: file.origin_name
    }
  }

  // PDF 处理
  if (file.type === FileTypes.DOCUMENT && file.extension === 'pdf') {
    // 支持 PDF 原生输入
    if (supportsPdfInput(model, provider)) {
      const base64Data = await window.api.file.base64(file.path)
      return {
        type: 'file',
        mediaType: 'application/pdf',
        data: base64Data,
        filename: file.origin_name
      }
    }

    // 大文件上传
    if (file.size > fileLimit && supportsLargeFileUpload(model, provider)) {
      return await handleLargeFileUpload(fileBlock, model, provider)
    }
  }

  return null
}
```

#### 大文件上传处理

```typescript
// 来源：aiCore/prepareParams/fileProcessor.ts
async function handleLargeFileUpload(fileBlock, model, provider) {
  // Gemini File API
  if (provider.id.includes('gemini') || provider.id.includes('google')) {
    return await handleGeminiFileUpload(fileBlock, provider)
  }

  // OpenAI 兼容
  if (supportsOpenAIFileUpload(provider)) {
    return await handleOpenAILargeFileUpload(fileBlock, provider)
  }

  return null
}

// Gemini 文件上传
async function handleGeminiFileUpload(fileBlock, provider) {
  const uploadResult = await uploadToGeminiFileAPI(fileBlock.file, provider)
  return {
    type: 'file',
    fileUri: uploadResult.uri,  // 使用 file URI
    mimeType: fileBlock.file.extension
  }
}
```

#### TextPart 转换（文本提取）

```typescript
// 来源：aiCore/prepareParams/fileProcessor.ts
async function convertFileBlockToTextPart(fileBlock) {
  const content = await extractFileContent(fileBlock.file)

  if (!content) return null

  return {
    type: 'text',
    text: `--- 文件开始 ---\n${content}\n--- 文件结束 ---`
  }
}

// 文件内容提取
async function extractFileContent(file: FileMetadata): Promise<string> {
  // PDF 提取
  if (file.extension === 'pdf') {
    return await window.api.file.extractPdfText(file.path)
  }

  // Office 文档提取（使用 officeparser）
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(file.extension)) {
    return await window.api.file.extractOfficeText(file.path)
  }

  // 纯文本
  if (file.type === FileTypes.TEXT) {
    return await window.api.file.readText(file.path)
  }

  return ''
}
```

## 服务商特定实现

### OpenAI

#### 消息转换实现

```typescript
// 来源：aiCore/legacy/clients/openai/OpenAIApiClient.ts
function convertMessageToSdkParam(message, model, provider) {
  // 纯文本消息
  if (!hasFiles && !hasImages) {
    return message.content
  }

  // 不支持数组内容的服务商
  if (!supportsArrayContent(provider)) {
    // 提取文件内容并追加到文本
    const fileContents = await extractAllFileContent(message.files)
    return message.content + '\n\n' + fileContents.join('\n\n')
  }

  // 支持多模态的服务商
  const parts = []

  // 文本部分
  if (message.content) {
    parts.push({ type: 'text', text: message.content })
  }

  // 图片部分（仅视觉模型）
  if (isVisionModel(model)) {
    for (const image of message.images) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: image  // base64 data URL 或远程 URL
        }
      })
    }
  }

  // 文档文件
  for (const file of message.files) {
    if (file.type === FileTypes.TEXT || file.type === FileTypes.DOCUMENT) {
      const content = await extractFileContent(file)
      parts.push({ type: 'text', text: content })
    }
  }

  return parts
}
```

#### 图片格式

OpenAI 支持两种方式：

1. **Base64 Data URL**（推荐用于本地文件）
```json
{
  "type": "image_url",
  "image_url": {
    "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
  }
}
```

2. **远程 URL**
```json
{
  "type": "image_url",
  "image_url": {
    "url": "https://example.com/image.jpg"
  }
}
```

#### API 请求示例

```typescript
// OpenAI Vision API 请求
{
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "这张图片里有什么？" },
        {
          type: "image_url",
          image_url: {
            url: "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
          }
        }
      ]
    }
  ]
}
```

### Anthropic Claude

#### 关键特性

1. **MIME 类型规范化**：`image/jpg` → `image/jpeg`
2. **原生 PDF 支持**：直接发送 base64 编码的 PDF
3. **文件大小限制**：PDF 限制 32MB

#### 消息格式（推测基于 Vercel AI SDK）

```typescript
// Claude 支持的内容格式
{
  role: "user",
  content: [
    { type: "text", text: "请分析这个文档" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "/9j/4AAQSkZJRg..."
      }
    },
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: "JVBERi0xLjQK..."
      }
    }
  ]
}
```

### Google Gemini

#### 文件上传流程

```typescript
// 1. 小文件直接内联
if (file.size < 20MB) {
  return {
    inlineData: {
      mimeType: file.type,
      data: base64Data
    }
  }
}

// 2. 大文件使用 File API
const uploadedFile = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
  method: 'POST',
  headers: {
    'X-Goog-Upload-Protocol': 'multipart',
    'Authorization': `Bearer ${apiKey}`
  },
  body: formData
})

// 3. 使用文件 URI
return {
  fileData: {
    fileUri: uploadedFile.uri,
    mimeType: file.type
  }
}
```

#### API 请求示例

```typescript
// Gemini API 请求
{
  contents: [
    {
      role: "user",
      parts: [
        { text: "分析这张图片" },
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: "/9j/4AAQSkZJRg..."
          }
        }
      ]
    }
  ],
  generationConfig: {
    temperature: 0.7
  }
}

// 大文件使用 fileData
{
  contents: [
    {
      role: "user",
      parts: [
        { text: "分析这个 PDF" },
        {
          fileData: {
            fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
            mimeType: "application/pdf"
          }
        }
      ]
    }
  ]
}
```

## 模型能力检查

### 模型能力矩阵

```typescript
// 来源：aiCore/prepareParams/modelCapabilities.ts

// 图片输入支持
function supportsImageInput(model, provider) {
  return isVisionModel(model)
}

// PDF 原生输入支持
function supportsPdfInput(model, provider) {
  // 模型白名单
  const supportedModels = ['qwen-long', 'qwen-doc']
  if (supportedModels.some(m => model.id.includes(m))) {
    return true
  }

  // 服务商白名单
  const supportedProviders = [
    'openai',
    'azure',
    'anthropic',
    'google',
    'gemini',
    'vertex',
    'bedrock'
  ]
  return supportedProviders.includes(provider.id)
}

// 大文件上传支持
function supportsLargeFileUpload(model, provider) {
  // 仅 Google 系列支持 File API
  return provider.id.includes('google') || provider.id.includes('gemini')
}

// 文件大小限制
function getModelFileLimit(model, fileType, provider) {
  // Anthropic PDF 限制
  if (provider.id === 'anthropic' && fileType === 'pdf') {
    return 32 * 1024 * 1024  // 32MB
  }

  // Google 系列限制
  if (provider.id.includes('google')) {
    return 20 * 1024 * 1024  // 20MB
  }

  // 默认无限制，由服务商自行处理
  return Infinity
}
```

### 视觉模型检测

```typescript
// 检测是否为视觉模型
function isVisionModel(model) {
  const visionKeywords = [
    'vision',
    'gpt-4-turbo',
    'gpt-4o',
    'claude-3',
    'gemini',
    'qwen-vl'
  ]

  return visionKeywords.some(keyword =>
    model.id.toLowerCase().includes(keyword)
  )
}
```

## 文件类型支持总结

### 支持的文件类型

| 文件类型 | 支持的模型 | 处理方式 |
|---------|-----------|---------|
| **图片** (JPEG, PNG, GIF, WebP) | 所有视觉模型 | Base64 内联或 URL 引用 |
| **PDF** | OpenAI、Claude、Gemini、Qwen-Long | 原生支持（base64）或文本提取 |
| **Word** (DOC, DOCX) | 所有模型 | 文本提取后发送 |
| **Excel** (XLS, XLSX) | 所有模型 | 文本提取后发送 |
| **PowerPoint** (PPT, PPTX) | 所有模型 | 文本提取后发送 |
| **纯文本** (TXT, MD, JSON) | 所有模型 | 直接读取内容 |

### 文件大小限制

| 服务商 | 图片限制 | PDF 限制 | 其他文档 |
|--------|---------|---------|---------|
| **OpenAI** | 无明确限制 | 无明确限制 | 文本提取 |
| **Anthropic** | 无明确限制 | 32MB | 文本提取 |
| **Google Gemini** | 20MB（直接）<br>无限制（File API） | 20MB（直接）<br>无限制（File API） | 文本提取 |

## 依赖包分析

### AI SDK

```json
{
  "@anthropic-ai/sdk": "^0.41.0",
  "@ai-sdk/openai": "^2.0.85",
  "@ai-sdk/google": "^2.0.49",
  "@ai-sdk/google-vertex": "^3.0.94",
  "@ai-sdk/anthropic": "自动包含",
  "@ai-sdk/mistral": "^2.0.24"
}
```

### 文件处理

```json
{
  "officeparser": "^4.2.0",      // Office 文档解析
  "pdf-parse": "最新版",          // PDF 文本提取
  "pdf-lib": "最新版",            // PDF 操作
  "sharp": "^0.34.3",            // 图片处理
  "browser-image-compression": "^2.0.2"  // 图片压缩
}
```

## 实现建议

### 1. 统一的消息转换层

```typescript
// 参考 Cherry Studio 的设计
class MessageConverter {
  // 转换为服务商特定格式
  async convert(message: Message, model: Model, provider: Provider) {
    const parts = []

    // 文本
    if (message.content) {
      parts.push(this.textPart(message.content))
    }

    // 图片（仅视觉模型）
    if (this.supportsVision(model)) {
      for (const image of message.images) {
        parts.push(await this.imagePart(image, provider))
      }
    }

    // 文件
    for (const file of message.files) {
      const part = await this.filePart(file, model, provider)
      if (part) parts.push(part)
    }

    return parts
  }

  async imagePart(image: string | File, provider: Provider) {
    // 统一转换为 base64
    const base64 = await this.toBase64(image)

    if (provider.id === 'openai') {
      return {
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${base64}` }
      }
    }

    // Vercel AI SDK 统一格式
    return {
      type: 'image',
      image: base64
    }
  }

  async filePart(file: FileMetadata, model: Model, provider: Provider) {
    // 1. 尝试原生支持
    if (this.supportsNativeFile(file, model, provider)) {
      return await this.nativeFilePart(file, provider)
    }

    // 2. 尝试大文件上传
    if (this.supportsFileUpload(provider) && file.size > this.sizeLimit) {
      return await this.uploadFilePart(file, provider)
    }

    // 3. 文本提取
    return await this.textExtractPart(file)
  }
}
```

### 2. 优雅降级策略

```typescript
class FileProcessor {
  async process(file: FileMetadata, model: Model, provider: Provider) {
    try {
      // 优先：原生格式
      if (this.supportsNative(file, model, provider)) {
        return await this.processNative(file, provider)
      }
    } catch (error) {
      console.warn('Native processing failed, trying upload', error)
    }

    try {
      // 次选：大文件上传
      if (this.supportsUpload(provider)) {
        return await this.processUpload(file, provider)
      }
    } catch (error) {
      console.warn('Upload failed, falling back to extraction', error)
    }

    // 兜底：文本提取
    return await this.extractText(file)
  }
}
```

### 3. 模型能力检测

```typescript
// 能力检测接口
interface ModelCapabilities {
  vision: boolean
  pdfInput: boolean
  fileUpload: boolean
  maxImageSize: number
  maxPdfSize: number
}

// 检测函数
function getModelCapabilities(model: Model, provider: Provider): ModelCapabilities {
  return {
    vision: isVisionModel(model),
    pdfInput: supportsPdfInput(model, provider),
    fileUpload: supportsFileUpload(provider),
    maxImageSize: getImageLimit(provider),
    maxPdfSize: getPdfLimit(provider)
  }
}
```

### 4. 文件验证

```typescript
class FileValidator {
  validate(file: FileMetadata, capabilities: ModelCapabilities) {
    // 类型检查
    if (file.type === 'image' && !capabilities.vision) {
      throw new Error('模型不支持图片输入')
    }

    // 大小检查
    if (file.type === 'image' && file.size > capabilities.maxImageSize) {
      throw new Error(`图片大小超过限制 ${capabilities.maxImageSize}`)
    }

    if (file.extension === 'pdf' && file.size > capabilities.maxPdfSize) {
      throw new Error(`PDF 大小超过限制 ${capabilities.maxPdfSize}`)
    }

    return true
  }
}
```

## 关键发现

### 1. 架构优势

- **统一抽象层**：使用 Vercel AI SDK 统一不同服务商的接口
- **优雅降级**：原生支持 → 文件上传 → 文本提取的三级降级策略
- **模块化设计**：清晰的职责分离（转换、验证、上传）

### 2. 最佳实践

- **图片处理**：优先使用 base64 内联，避免 URL 引用的网络问题
- **大文件处理**：使用服务商的文件上传 API（如 Gemini File API）
- **PDF 处理**：优先原生支持，不支持则提取文本
- **错误处理**：每一步都有 fallback，确保用户体验

### 3. 性能优化

- **图片压缩**：限制 1MB、300px，减少传输大小
- **批量处理**：并行处理多个文件
- **缓存机制**：已上传的文件使用 URI 引用

### 4. 兼容性处理

- **MIME 类型规范化**：Anthropic 要求 `image/jpeg` 而非 `image/jpg`
- **服务商检测**：根据 provider ID 选择不同的处理策略
- **版本兼容**：保留 legacy 代码，逐步迁移到新架构

## API 请求格式对比

### OpenAI

```typescript
// Vision API
{
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "描述这张图片" },
        {
          type: "image_url",
          image_url: {
            url: "data:image/jpeg;base64,..."
          }
        }
      ]
    }
  ]
}
```

### Anthropic (推测基于 Vercel AI SDK)

```typescript
{
  model: "claude-3-5-sonnet-20241022",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "分析这个 PDF" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "..."
          }
        },
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "..."
          }
        }
      ]
    }
  ]
}
```

### Google Gemini

```typescript
// 小文件（内联）
{
  contents: [
    {
      role: "user",
      parts: [
        { text: "这是什么？" },
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: "base64..."
          }
        }
      ]
    }
  ]
}

// 大文件（File API）
{
  contents: [
    {
      role: "user",
      parts: [
        { text: "分析这个文档" },
        {
          fileData: {
            fileUri: "https://generativelanguage.googleapis.com/v1beta/files/xxx",
            mimeType: "application/pdf"
          }
        }
      ]
    }
  ]
}
```

## 代码实现参考

### 完整的文件处理流程

```typescript
// 基于 Cherry Studio 的实现
class MultimodalMessageBuilder {
  async buildMessage(
    content: string,
    files: File[],
    model: Model,
    provider: Provider
  ) {
    const capabilities = this.getCapabilities(model, provider)
    const parts = []

    // 添加文本
    if (content) {
      parts.push({ type: 'text', text: content })
    }

    // 处理文件
    for (const file of files) {
      const fileMetadata = await this.createFileMetadata(file)

      // 验证
      this.validateFile(fileMetadata, capabilities)

      // 转换
      const part = await this.convertFile(fileMetadata, model, provider, capabilities)
      if (part) {
        parts.push(part)
      }
    }

    return {
      role: 'user',
      content: parts
    }
  }

  async convertFile(
    file: FileMetadata,
    model: Model,
    provider: Provider,
    capabilities: ModelCapabilities
  ) {
    // 图片
    if (file.type === FileTypes.IMAGE) {
      if (!capabilities.vision) {
        console.warn('Model does not support images, skipping')
        return null
      }
      return await this.convertImage(file, provider)
    }

    // PDF
    if (file.extension === 'pdf') {
      if (capabilities.pdfInput && file.size <= capabilities.maxPdfSize) {
        return await this.convertPdfNative(file, provider)
      }

      if (capabilities.fileUpload && file.size > capabilities.maxPdfSize) {
        return await this.uploadFile(file, provider)
      }

      return await this.extractPdfText(file)
    }

    // Office 文档
    if (this.isOfficeDocument(file)) {
      return await this.extractOfficeText(file)
    }

    // 纯文本
    if (file.type === FileTypes.TEXT) {
      return await this.readTextFile(file)
    }

    return null
  }

  async convertImage(file: FileMetadata, provider: Provider) {
    // 读取并压缩
    const compressed = await compressImage(file.path)
    const base64 = await convertToBase64(compressed)

    // 规范化 MIME 类型
    let mimeType = file.mimeType
    if (provider.id === 'anthropic' && mimeType === 'image/jpg') {
      mimeType = 'image/jpeg'
    }

    // 根据服务商返回不同格式
    if (provider.id === 'openai') {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`
        }
      }
    }

    // Vercel AI SDK 统一格式
    return {
      type: 'image',
      image: base64,
      mimeType: mimeType
    }
  }

  async convertPdfNative(file: FileMetadata, provider: Provider) {
    const base64 = await readFileAsBase64(file.path)

    return {
      type: 'file',
      data: base64,
      mimeType: 'application/pdf',
      filename: file.origin_name
    }
  }

  async uploadFile(file: FileMetadata, provider: Provider) {
    if (provider.id.includes('gemini') || provider.id.includes('google')) {
      const result = await this.geminiFileUpload(file, provider)
      return {
        type: 'file',
        fileUri: result.uri,
        mimeType: file.mimeType
      }
    }

    throw new Error('File upload not supported for this provider')
  }

  async geminiFileUpload(file: FileMetadata, provider: Provider) {
    const formData = new FormData()
    formData.append('file', await readFile(file.path))

    const response = await fetch(
      'https://generativelanguage.googleapis.com/upload/v1beta/files',
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'multipart',
          'Authorization': `Bearer ${provider.apiKey}`
        },
        body: formData
      }
    )

    return await response.json()
  }

  async extractPdfText(file: FileMetadata) {
    const text = await extractPdfContent(file.path)
    return {
      type: 'text',
      text: `--- PDF 文件: ${file.origin_name} ---\n${text}\n--- 文件结束 ---`
    }
  }

  async extractOfficeText(file: FileMetadata) {
    const text = await extractOfficeContent(file.path)
    return {
      type: 'text',
      text: `--- 文档: ${file.origin_name} ---\n${text}\n--- 文件结束 ---`
    }
  }
}
```

## 总结

Cherry Studio 的多模态处理实现展示了以下优秀实践：

1. **统一抽象**：使用 Vercel AI SDK 作为统一层，简化多服务商集成
2. **优雅降级**：三级处理策略确保最大兼容性
3. **模块化设计**：清晰的职责分离，易于维护和扩展
4. **性能优化**：图片压缩、批量处理、文件上传 API
5. **错误处理**：每一步都有 fallback，用户体验优先

这些设计可以直接应用到 SSRPrompt 项目中，提升多模态内容的处理能力。
