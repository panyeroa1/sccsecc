import { createClient } from "@deepgram/sdk";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.DEEPGRAM_API_KEY) return NextResponse.json({ error: 'No Key' }, { status: 500 });
  try {
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    const { result } = await deepgram.manage.v1.projects.list();
    const pid = result?.projects?.[0]?.project_id;
    if (!pid) return NextResponse.json({ error: 'No Project' }, { status: 500 });
    const { result: k } = await deepgram.manage.v1.keys.create(pid, { comment: 'client', scopes: ['usage:write'], time_to_live_in_seconds: 60 });
    return NextResponse.json({ key: k.key });
  } catch (e) {
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}
