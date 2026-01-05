
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { text, targetLang } = await request.json();

    if (!text || !targetLang) {
      return new NextResponse('Missing text or targetLang', { status: 400 });
    }

    const apiKey = process.env.OLLAMA_API_KEY;

    // Local Ollama determines if it needs a key (usually not). 
    // We proceed to fetch even if apiKey is undefined.

    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    console.log(`Sending translation request to: ${ollamaUrl}/v1/chat/completions`, { model: 'gemini-2.0-flash-exp', targetLang });

    const response = await fetch(`${ollamaUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemini-2.0-flash-exp',
        messages: [{
          role: 'user',
          content: `Translate the following text to ${targetLang}. Provide ONLY the translated text, no other explanation or commentary.\n\nText:\n${text}`
        }],
        stream: false
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Ollama Translation Error:', err);
      return new NextResponse(err, { status: response.status });
    }

    const data = await response.json();
    // Ollama OpenAI-compatible API structure: choices[0].message.content
    // Ollama chat API structure: message.content
    const translation = data.choices?.[0]?.message?.content || data.message?.content || text;

    return NextResponse.json({ translation: translation.trim() });
  } catch (error) {
    console.error('Orbit translation route error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}