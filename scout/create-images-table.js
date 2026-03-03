const https = require('https');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const sql = `
CREATE TABLE IF NOT EXISTS dovive_product_images (
  id bigint generated always as identity primary key,
  asin text NOT NULL,
  keyword text,
  image_type text,
  image_index integer,
  url text NOT NULL,
  ocr_text text,
  ocr_status text DEFAULT 'pending',
  scraped_at timestamptz DEFAULT now()
);
ALTER TABLE dovive_product_images ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dovive_product_images' AND policyname='anon_all_images') THEN
    CREATE POLICY anon_all_images ON dovive_product_images FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_product_images_asin ON dovive_product_images(asin);
CREATE INDEX IF NOT EXISTS idx_product_images_ocr_status ON dovive_product_images(ocr_status);
`;

const MGMT_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';
const body = JSON.stringify({ query: sql });

const req = https.request({
  hostname: 'api.supabase.com',
  path: '/v1/projects/fhfqjcvwcxizbioftvdw/database/query',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + MGMT_TOKEN,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Status:', res.statusCode, d));
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
