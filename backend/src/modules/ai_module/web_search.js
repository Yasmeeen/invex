import https from 'https';

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          try {
            resolve(JSON.parse(data || '{}'));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Optional web search for market pricing.
 * Uses SerpAPI if SERPAPI_KEY is present; otherwise returns null.
 */
export async function searchMarketPrices(query) {
  const enabled = String(process.env.INTERNET_ALLOWED || '').toLowerCase() === 'true';
  const key = process.env.SERPAPI_KEY || '';
  if (!enabled || !key) {
    return null;
  }

  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return null;

  const url = `https://serpapi.com/search.json?engine=google&q=${q}&num=5&api_key=${encodeURIComponent(
    key
  )}`;
  const json = await httpsGetJson(url);
  const results = (json?.organic_results || []).slice(0, 5).map((r) => ({
    title: r.title,
    url: r.link,
  }));
  return {
    query: String(query || ''),
    fetchedAt: new Date().toISOString(),
    sources: results,
  };
}

