import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, CheckCircle2, XCircle, Loader2, Image, FileText, Table2, AlertCircle } from 'lucide-react';
import { Button } from '../ui';
import { callAIModel, type FileAttachment } from '../../lib/ai-service';
import { getModelCapabilities, inferPdfSupport } from '../../lib/model-capabilities';
import type { Model, Provider } from '../../types';

interface ModelCapabilityTestProps {
  models: Model[];
  providers: Provider[];
}

interface TestResult {
  modelId: string;
  modelName: string;
  providerName: string;
  providerType: string;
  imageSupport: 'success' | 'failed' | 'skipped' | 'pending';
  pdfSupport: 'success' | 'failed' | 'skipped' | 'pending';
  imageError?: string;
  pdfError?: string;
  imageExpected: boolean;
  pdfExpected: boolean;
}

// 1x1 红色像素的 PNG 图片 (Base64)
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// 简单的 PDF 文件 (Base64) - 包含文本 "Test PDF"
const TEST_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPJ4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQovQ29udGVudHMgNCAwIFIKL1Jlc291cmNlcyA8PAovRm9udCA8PCAvRjEgNSAwIFIgPj4KPj4KPj4KZW5kb2JqCjQgMCBvYmoKPDwKL0xlbmd0aCA0NAo+PgpzdHJlYW0KQlQKL0YxIDI0IFRmCjEwMCA3MDAgVGQKKFRlc3QgUERGKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNzAgMDAwMDAgbiAKMDAwMDAwMDM2MyAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjQ0MgolJUVPRgo=';

export function ModelCapabilityTest({ models, providers }: ModelCapabilityTestProps) {
  const { t } = useTranslation('settings');
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('');

  const runTests = async () => {
    setTesting(true);
    setResults([]);

    // 获取所有启用的模型
    const enabledModels = models.filter(m => {
      const provider = providers.find(p => p.id === m.provider_id);
      return provider?.enabled && provider?.api_key;
    });

    const newResults: TestResult[] = [];

    for (const model of enabledModels) {
      const provider = providers.find(p => p.id === model.provider_id);
      if (!provider) continue;

      setCurrentModel(model.name);

      // 获取预期能力
      const capabilities = getModelCapabilities(provider.type, model.model_id, model.supports_vision);
      const expectedPdf = inferPdfSupport(provider.type, model.model_id);

      const result: TestResult = {
        modelId: model.id,
        modelName: model.name,
        providerName: provider.name,
        providerType: provider.type,
        imageSupport: 'pending',
        pdfSupport: 'pending',
        imageExpected: capabilities.supportsVision,
        pdfExpected: expectedPdf,
      };

      // 测试图片支持
      if (capabilities.supportsVision) {
        try {
          const imageFile: FileAttachment = {
            name: 'test.png',
            type: 'image/png',
            base64: TEST_IMAGE_BASE64,
          };

          const response = await callAIModel(
            provider,
            model.model_id,
            '这是什么颜色的图片？请用一个词回答。',
            [imageFile]
          );

          if (response.error) {
            result.imageSupport = 'failed';
            result.imageError = response.error;
          } else if (response.content) {
            result.imageSupport = 'success';
          } else {
            result.imageSupport = 'failed';
            result.imageError = t('noResponse');
          }
        } catch (e) {
          result.imageSupport = 'failed';
          result.imageError = e instanceof Error ? e.message : String(e);
        }
      } else {
        result.imageSupport = 'skipped';
      }

      // 测试 PDF 支持
      if (expectedPdf && capabilities.supportsVision) {
        try {
          const pdfFile: FileAttachment = {
            name: 'test.pdf',
            type: 'application/pdf',
            base64: TEST_PDF_BASE64,
          };

          const response = await callAIModel(
            provider,
            model.model_id,
            '这个 PDF 文件中包含什么文字？请直接回答。',
            [pdfFile]
          );

          if (response.error) {
            result.pdfSupport = 'failed';
            result.pdfError = response.error;
          } else if (response.content) {
            result.pdfSupport = 'success';
          } else {
            result.pdfSupport = 'failed';
            result.pdfError = t('noResponse');
          }
        } catch (e) {
          result.pdfSupport = 'failed';
          result.pdfError = e instanceof Error ? e.message : String(e);
        }
      } else {
        result.pdfSupport = 'skipped';
      }

      newResults.push(result);
      setResults([...newResults]);
    }

    setCurrentModel('');
    setTesting(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-rose-500" />;
      case 'skipped':
        return <AlertCircle className="w-4 h-4 text-slate-500" />;
      case 'pending':
        return <Loader2 className="w-4 h-4 text-cyan-500 animate-spin" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: string, expected: boolean) => {
    switch (status) {
      case 'success':
        return t('supported');
      case 'failed':
        return t('failed');
      case 'skipped':
        return expected ? t('skipped') : t('notSupported');
      case 'pending':
        return t('testingStatus');
      default:
        return '-';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-slate-200 light:text-slate-800">{t('modelCapabilityTest')}</h4>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
            {t('testModelCapabilities')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={runTests}
          disabled={testing}
        >
          {testing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('testing')}: {currentModel}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>{t('startTest')}</span>
            </>
          )}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="border border-slate-700 light:border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 light:bg-slate-100">
              <tr>
                <th className="px-3 py-2 text-left text-slate-400 light:text-slate-600 font-medium">{t('model')}</th>
                <th className="px-3 py-2 text-left text-slate-400 light:text-slate-600 font-medium">{t('provider')}</th>
                <th className="px-3 py-2 text-center text-slate-400 light:text-slate-600 font-medium">
                  <div className="flex items-center justify-center gap-1">
                    <Image className="w-3.5 h-3.5" />
                    <span>{t('image')}</span>
                  </div>
                </th>
                <th className="px-3 py-2 text-center text-slate-400 light:text-slate-600 font-medium">
                  <div className="flex items-center justify-center gap-1">
                    <FileText className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 light:divide-slate-200">
              {results.map((result) => (
                <tr key={result.modelId} className="hover:bg-slate-800/30 light:hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="text-slate-200 light:text-slate-800">{result.modelName}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-slate-400 light:text-slate-600 text-xs">
                      {result.providerName}
                      <span className="ml-1 text-slate-500">({result.providerType})</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1">
                        {getStatusIcon(result.imageSupport)}
                        <span className={`text-xs ${
                          result.imageSupport === 'success' ? 'text-emerald-400' :
                          result.imageSupport === 'failed' ? 'text-rose-400' :
                          'text-slate-500'
                        }`}>
                          {getStatusText(result.imageSupport, result.imageExpected)}
                        </span>
                      </div>
                      {result.imageError && (
                        <span className="text-xs text-rose-400/70 max-w-[150px] truncate" title={result.imageError}>
                          {result.imageError}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1">
                        {getStatusIcon(result.pdfSupport)}
                        <span className={`text-xs ${
                          result.pdfSupport === 'success' ? 'text-emerald-400' :
                          result.pdfSupport === 'failed' ? 'text-rose-400' :
                          'text-slate-500'
                        }`}>
                          {getStatusText(result.pdfSupport, result.pdfExpected)}
                        </span>
                      </div>
                      {result.pdfError && (
                        <span className="text-xs text-rose-400/70 max-w-[150px] truncate" title={result.pdfError}>
                          {result.pdfError}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-slate-500 light:text-slate-600 space-y-1">
        <p>{t('testInstructions')}</p>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li><span className="text-emerald-400">{t('supported')}</span> - {t('testSupportedDesc')}</li>
          <li><span className="text-rose-400">{t('failed')}</span> - {t('testFailedDesc')}</li>
          <li><span className="text-slate-400">{t('notSupported')}</span> - {t('testNotSupportedDesc')}</li>
          <li><span className="text-slate-400">{t('skipped')}</span> - {t('testSkippedDesc')}</li>
        </ul>
      </div>
    </div>
  );
}
