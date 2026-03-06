// Test Keepa Phase 2 with 1 ASIN
process.env.SUPABASE_URL = 'https://fhfqjcvwcxizbioftvdw.supabase.co';
process.env.SUPABASE_KEY = 'sb_secret_Urw2XKj4d9QUsvcEnQrKBA_TzA_KEnH';

// Patch main to only run 1 ASIN
const originalMain = require('./keepa-phase2.js');
