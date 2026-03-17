import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

function tryParseJSON(text: string): object | null {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = codeBlock ? codeBlock[1].trim() : text.trim();

  for (const attempt of [candidate, candidate.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!attempt) continue;
    try {
      const parsed = JSON.parse(attempt);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch { /* try next */ }
  }
  return null;
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.status === 429) {
      const wait = Math.min(parseInt(err.response?.headers?.get?.('retry-after') ?? '62', 10), 65) * 1000;
      console.log(`Rate limited — retrying in ${wait / 1000}s…`);
      await new Promise((r) => setTimeout(r, wait));
      return await fn();
    }
    throw err;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { location, radius } = req.body as { location: string; radius: number };

  if (!location || !radius) {
    return res.status(400).json({ error: 'Location and radius are required.' });
  }

  try {
    // ── Step 1: Search the web for deals ──────────────────────────────────
    const searchPrompt =
      `Find current this-week meat sale prices at grocery stores near ${location}. ` +
      `Search for: weekly flyer meat deals ${location}, grocery store meat specials ${location} this week, ` +
      `chicken beef pork on sale ${location}. ` +
      `Also search flipp.com for ${location} meat deals. ` +
      `Look at any supermarket, grocery chain, or big-box store (e.g. Walmart, Costco, Kroger, Safeway, ` +
      `Whole Foods, Save-On-Foods, Sobeys, Metro, Loblaws, FreshCo, No Frills, Food Basics, T&T). ` +
      `Report ALL deals found — beef, chicken, pork, lamb, seafood, deli meats. ` +
      `For each deal include: store name, exact product/cut, sale price with unit (per lb or kg), ` +
      `regular price if shown, valid dates, and the source URL.`;

    const searchResponse = await withRateLimitRetry(() =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as const],
        messages: [{ role: 'user', content: searchPrompt }],
      })
    );

    console.log('Search stop_reason:', searchResponse.stop_reason);

    // ── Step 2: Format findings as JSON ───────────────────────────────────
    const jsonSchema = `{
  "searchedArea": "${location}",
  "deals": [
    {
      "meatType": "beef|chicken|pork|lamb|seafood|deli|other",
      "cut": "product name",
      "store": "store name",
      "price": 0.00,
      "unit": "lb or kg",
      "description": "full description",
      "originalPrice": null,
      "validUntil": null,
      "savings": null,
      "conditions": null,
      "url": "https://..."
    }
  ]
}`;

    // Only pass the text summary to the format step — strip raw search result
    // blocks (tool_use / tool_result) which are very large and not needed.
    const searchSummary = searchResponse.content
      .filter((b) => b.type === 'text')
      .map((b) => b.type === 'text' ? b.text : '')
      .join('\n');

    const formatMessages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content:
          `Here are this week's meat deals found at grocery stores near ${location}:\n\n` +
          searchSummary +
          `\n\nConvert ALL of these deals into this exact JSON structure. ` +
          `Include every deal mentioned — do not omit any. ` +
          `Output ONLY the raw JSON — no markdown fences, no explanation, nothing else:\n\n` +
          jsonSchema +
          `\n\nUse null for any unknown fields. ` +
          `Only return an empty deals array if there are truly zero meat deals.`,
      },
    ];

    const formatResponse = await withRateLimitRetry(() =>
      client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        messages: formatMessages,
      })
    );

    console.log('Format stop_reason:', formatResponse.stop_reason);

    const textBlock = formatResponse.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return res.status(500).json({ error: 'No response from formatting step.' });
    }

    const data = tryParseJSON(textBlock.text);
    if (!data) {
      console.error('Failed to parse JSON. Full text:', textBlock.text);
      return res.status(500).json({ error: 'Could not parse deal data from response.' });
    }

    return res.json(data);
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: `Search failed: ${err instanceof Error ? err.message : err}` });
  }
}
