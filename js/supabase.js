import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export const configured =
  Boolean(SUPABASE_URL && SUPABASE_KEY) &&
  !SUPABASE_URL.includes('YOUR-') &&
  !SUPABASE_KEY.includes('YOUR-');

export const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
