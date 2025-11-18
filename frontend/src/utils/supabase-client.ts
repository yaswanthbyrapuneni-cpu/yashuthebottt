import { createClient } from '@supabase/supabase-js';

// Get credentials from .env file
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

// Create Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper function to generate unique session IDs
export function generateSessionId(): string {
  return crypto.randomUUID();
}