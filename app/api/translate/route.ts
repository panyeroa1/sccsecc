import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { text, targetLang } = await request.json();

    if (!text || !targetLang) {
      return new NextResponse('Missing text or targetLang', { status: 400 });
    }

    const normalizeGoogleLang = (lang: string) => {
      const trimmed = String(lang).trim();
      if (!trimmed) return 'en';
      const lower = trimmed.toLowerCase();
      if (lower === 'auto' || lower === 'multi') return 'en';
      if (lower === 'zh-hans') return 'zh-CN';
      if (lower === 'zh-hant') return 'zh-TW';
      if (lower.startsWith('zh-')) return trimmed;
      return lower.split('-')[0];
    };

    try {
      const googleTarget = normalizeGoogleLang(targetLang);
      const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(googleTarget)}&dt=t&q=${encodeURIComponent(text)}`;
      const googleRes = await fetch(googleUrl);
      if (googleRes.ok) {
        const data = await googleRes.json();
        const translation = Array.isArray(data?.[0]) ? data[0].map((x: any) => x[0]).join('') : '';
        if (translation) return NextResponse.json({ translation });
      } else {
        const err = await googleRes.text();
        console.warn(`[Translate] Google failed (${googleRes.status}): ${err}. Falling back...`);
      }
    } catch (e) {
      console.error('[Translate] Google translate error:', e);
    }

    const apiKey = process.env.OLLAMA_API_KEY;
    if (!apiKey) {
      return new NextResponse('Ollama API key not configured', { status: 503 });
    }

    const model = process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';

    const body = {
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a professional translator. Translate user text as literally as possible while keeping natural grammar, and reply with only the translated text.',
        },
        {
          role: 'user',
          content: `Translate the following text into ${targetLang}.\n\n${text}`,
        },
      ],
      stream: false,
    };

    const res = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorMessage = await res.text();
      console.error('Ollama translation error:', res.status, errorMessage);
      return new NextResponse(`Ollama translation failed: ${res.status}`, { status: res.status });
    }

    const data = await res.json();
    const translation = data?.message?.content?.trim() || text;

    return NextResponse.json({ translation });
  } catch (error: any) {
    console.error('Ollama translation route error:', error);
    return new NextResponse(error.message || 'Internal error', { status: 500 });
  }
}
