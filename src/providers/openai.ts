/**
 * YamX - OpenAI Provider (GPT-5.x, GPT-4.x, o-series, etc.)
 */

import { OpenAIChatProvider } from './openai-chat.js';

export class OpenAIProvider extends OpenAIChatProvider {
  constructor(apiKey: string, model: string = 'gpt-5.2', baseURL?: string) {
    super({ name: 'openai', apiKey, model, baseURL: baseURL?.trim() || undefined });
  }
}
