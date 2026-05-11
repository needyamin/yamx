import { Provider } from './base.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import { KimiProvider } from './kimi.js';
import { GrokProvider } from './grok.js';

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'kimi' | 'grok' | 'openrouter' | 'ollama';

const PROVIDER_NAMES = new Set<ProviderName>([
  'openai',
  'anthropic',
  'gemini',
  'kimi',
  'grok',
  'openrouter',
  'ollama',
]);

export function normalizeProviderName(value: unknown): ProviderName {
  const provider = String(value || '').trim().toLowerCase() as ProviderName;
  return PROVIDER_NAMES.has(provider) ? provider : 'openrouter';
}

export function resolveCloudApiKey(cfg: any, provider: Exclude<ProviderName, 'ollama'>): string | undefined {
  const prov = cfg.providers || {};
  switch (provider) {
    case 'kimi':
      return prov.kimi?.apiKey || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
    case 'grok':
      return prov.grok?.apiKey || process.env.XAI_API_KEY;
    default: {
      const block = prov[provider] as { apiKey?: string } | undefined;
      return block?.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`];
    }
  }
}

/** Cloud providers need an API key; Ollama does not. */
export function providerUsesCloudApiKey(p: ProviderName): boolean {
  return p !== 'ollama';
}

/** True when config + env has a credential for this provider (always true for Ollama). */
export function hasCloudApiKey(cfg: any, provider: ProviderName): boolean {
  if (!providerUsesCloudApiKey(provider)) return true;
  const key = resolveCloudApiKey(cfg, provider as Exclude<ProviderName, 'ollama'>);
  return Boolean(key && String(key).trim());
}

export function createProvider(name: string, model: string | undefined, cfg: any): Provider {
  const provider = normalizeProviderName(name);
  switch (provider) {
    case 'openai': {
      const key = resolveCloudApiKey(cfg, 'openai');
      if (!key) throw new Error('OpenAI API key not found. Set OPENAI_API_KEY or run: yamx --onboard');
      return new OpenAIProvider(key, model || cfg.providers?.openai?.model || 'gpt-5.2');
    }
    case 'anthropic': {
      const key = resolveCloudApiKey(cfg, 'anthropic');
      if (!key) throw new Error('Anthropic API key not found. Set ANTHROPIC_API_KEY or run: yamx --onboard');
      return new AnthropicProvider(key, model || cfg.providers?.anthropic?.model || 'claude-sonnet-4-20250514');
    }
    case 'gemini': {
      const key = resolveCloudApiKey(cfg, 'gemini');
      if (!key) throw new Error('Gemini API key not found. Set GEMINI_API_KEY or run: yamx --onboard');
      return new GeminiProvider(key, model || cfg.providers?.gemini?.model || 'gemini-3-flash-preview');
    }
    case 'kimi': {
      const key = resolveCloudApiKey(cfg, 'kimi');
      if (!key) {
        throw new Error(
          'Kimi / Moonshot API key not found. Set KIMI_API_KEY, MOONSHOT_API_KEY (see platform.kimi.ai), or run: yamx --onboard'
        );
      }
      return new KimiProvider(key, model || cfg.providers?.kimi?.model || 'kimi-k2.6');
    }
    case 'grok': {
      const key = resolveCloudApiKey(cfg, 'grok');
      if (!key) throw new Error('xAI Grok API key not found. Set XAI_API_KEY (see console.x.ai) or run: yamx --onboard');
      return new GrokProvider(key, model || cfg.providers?.grok?.model || 'grok-4.3');
    }
    case 'ollama': {
      const baseUrl = cfg.providers?.ollama?.baseUrl || 'http://localhost:11434';
      return new OllamaProvider(baseUrl, model || cfg.providers?.ollama?.model || 'qwen2.5-coder');
    }
    case 'openrouter': {
      const key = resolveCloudApiKey(cfg, 'openrouter');
      if (!key) throw new Error('OpenRouter API key not found. Set OPENROUTER_API_KEY or run: yamx --onboard');
      return new OpenRouterProvider(key, model || cfg.providers?.openrouter?.model || 'deepseek-chat');
    }
  }
}
