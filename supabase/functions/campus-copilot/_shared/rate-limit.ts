import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export async function checkRateLimit(
  admin: SupabaseClient,
  identifier: string,
  action: string,
  maxCount: number,
  windowMinutes: number
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count } = await admin
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('identifier', identifier)
    .eq('action', action)
    .gte('created_at', windowStart);

  if ((count ?? 0) >= maxCount) return false;

  await admin.from('rate_limit_events').insert({ identifier, action });
  return true;
}
