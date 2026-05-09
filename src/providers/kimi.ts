/**
 * YamX - Kimi / Moonshot AI (OpenAI-compatible Chat Completions)
 *
 * API: https://api.moonshot.ai/v1 · Keys: https://platform.kimi.ai/
 */

import { OpenAIChatProvider } from './openai-chat.js';

export class KimiProvider extends OpenAIChatProvider {
  constructor(apiKey: string, model: string = 'kimi-k2.6') {
    super({
      name: 'kimi',
      apiKey,
      model,
      baseURL: 'https://api.moonshot.ai/v1',
    });
  }
}
