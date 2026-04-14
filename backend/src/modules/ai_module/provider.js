import https from 'https';

function httpsJson({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          ...(headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          }
          try {
            resolve(JSON.parse(data || '{}'));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

export class OpenAIProvider {
  constructor({ apiKey, model }) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
  }

  async generateText({ system, user }) {
    const payload = {
      model: this.model,
      messages: [
        system ? { role: 'system', content: String(system) } : null,
        { role: 'user', content: String(user) },
      ].filter(Boolean),
      temperature: 0.2,
    };

    const json = await httpsJson({
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: payload,
    });

    const text = json?.choices?.[0]?.message?.content;
    return String(text || '').trim();
  }
}

export function createProvider() {
  const provider = String(process.env.AI_PROVIDER || 'openai').toLowerCase();
  const apiKey = process.env.AI_API_KEY || '';
  const model = process.env.AI_MODEL || '';

  if (!apiKey) {
    return null;
  }

  if (provider === 'openai') {
    return new OpenAIProvider({ apiKey, model });
  }

  // Unknown provider → treat as not configured
  return null;
}

