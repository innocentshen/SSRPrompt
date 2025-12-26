import { useTranslation } from 'react-i18next';
import { Settings2, RotateCcw } from 'lucide-react';
import { PromptConfig, DEFAULT_PROMPT_CONFIG } from '../../types/database';
import { Slider, Collapsible, Button } from '../ui';

interface ParameterPanelProps {
  config: PromptConfig;
  onChange: (config: PromptConfig) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}

export function ParameterPanel({ config, onChange, disabled = false, defaultOpen = false }: ParameterPanelProps) {
  const { t } = useTranslation('prompts');

  const handleChange = (key: keyof PromptConfig, value: number) => {
    onChange({ ...config, [key]: value });
  };

  const handleReset = () => {
    onChange(DEFAULT_PROMPT_CONFIG);
  };

  const isModified = JSON.stringify(config) !== JSON.stringify(DEFAULT_PROMPT_CONFIG);

  return (
    <Collapsible
      title={t('modelParameters')}
      icon={<Settings2 className="w-4 h-4 text-cyan-400 light:text-cyan-600" />}
      defaultOpen={defaultOpen}
      action={
        isModified && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-xs"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            {t('resetToDefault')}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <Slider
          label={t('temperature')}
          value={config.temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(value) => handleChange('temperature', value)}
          tooltip={t('temperatureTooltip')}
          disabled={disabled}
        />

        <Slider
          label={t('topP')}
          value={config.top_p}
          min={0}
          max={1}
          step={0.1}
          onChange={(value) => handleChange('top_p', value)}
          tooltip={t('topPTooltip')}
          disabled={disabled}
        />

        <Slider
          label={t('frequencyPenalty')}
          value={config.frequency_penalty}
          min={0}
          max={2}
          step={0.1}
          onChange={(value) => handleChange('frequency_penalty', value)}
          tooltip={t('frequencyPenaltyTooltip')}
          disabled={disabled}
        />

        <Slider
          label={t('presencePenalty')}
          value={config.presence_penalty}
          min={0}
          max={2}
          step={0.1}
          onChange={(value) => handleChange('presence_penalty', value)}
          tooltip={t('presencePenaltyTooltip')}
          disabled={disabled}
        />

        <Slider
          label={t('maxTokens')}
          value={config.max_tokens}
          min={1}
          max={32000}
          step={1}
          onChange={(value) => handleChange('max_tokens', value)}
          tooltip={t('maxTokensTooltip')}
          disabled={disabled}
        />
      </div>
    </Collapsible>
  );
}
