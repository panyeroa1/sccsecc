
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("⚠️ Supabase credentials not found. Database features will be disabled.");
} else {
  // console.log(`🔗 Supabase: Initializing with ${SUPABASE_URL}`);
  // console.log(`🔑 Supabase Key prefix: ${SUPABASE_KEY.substring(0, 10)}...`);
}
// For debugging "Invalid API key" issues
if (typeof window !== 'undefined') {
  (window as any).__SUPABASE_DEBUG = {
    url: SUPABASE_URL,
    key_prefix: SUPABASE_KEY ? SUPABASE_KEY.substring(0, 12) + '...' : 'missing',
    key_suffix: SUPABASE_KEY ? '...' + SUPABASE_KEY.substring(SUPABASE_KEY.length - 8) : 'missing'
  };
}

// Create a safe client that won't crash if env vars are missing
export const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null as any; // Fallback to null to prevent crashes

if (!supabase) {
  console.warn("⚠️ Supabase client not initialized - database features will be disabled");
}
