/**
 * YamX - xAI Grok (OpenAI-compatible Chat Completions legacy endpoint)
 *
 * API: https://api.x.ai/v1 · Keys: https://console.x.ai/
 */

import { OpenAIChatProvider } from './openai-chat.js';

export class GrokProvider extends OpenAIChatProvider {
  constructor(apiKey: string, model: string = 'grok-4.3') {
    super({
      name: 'grok',
      apiKey,
      model,
      baseURL: 'https://api.x.ai/v1',
      /** xAI recommends a long timeout for reasoning-capable models */
      timeout: 360_000,
    });
  }
}
