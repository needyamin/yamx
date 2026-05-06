/**
 * YamX - Web & Fetch Tools
 * Fetch URLs, read documentation, download content.
 */

import https from 'https';
import http from 'http';
import { Tool } from './registry.js';

function fetchUrl(url: string, maxLen = 50000): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'YamX-CLI/2.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, maxLen).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        data += chunk;
        if (data.length > maxLen) {
          res.destroy();
          resolve(data.slice(0, maxLen) + '\n\n[Content truncated]');
        }
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

/** Strip HTML tags and extract text content */
function htmlToText(html: string): string {
  // Remove script and style blocks
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Limit length
  return text.slice(0, 30000);
}

export const fetchUrlTool: Tool = {
  definition: {
    name: 'fetch_url',
    description: `Fetch content from a URL. Use this to read documentation, check API responses, or download text content. HTML pages are automatically converted to plain text. Useful for: reading docs, checking endpoints, fetching READMEs from GitHub.`,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        raw: { type: 'boolean', description: 'If true, return raw content without HTML stripping (default: false)' },
      },
      required: ['url'],
    },
  },
  async execute(args) {
    try {
      const content = await fetchUrl(args.url);
      const contentType = content.slice(0, 200).toLowerCase();

      // Auto-detect HTML and strip
      if (!args.raw && (contentType.includes('<!doctype') || contentType.includes('<html'))) {
        const text = htmlToText(content);
        return `[Fetched ${args.url}]\n\n${text}`;
      }

      return `[Fetched ${args.url}]\n\n${content}`;
    } catch (error: any) {
      return `Error fetching URL: ${error.message}`;
    }
  },
};
