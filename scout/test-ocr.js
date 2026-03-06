require('dotenv').config();
const { createWorker } = require('tesseract.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
  // Get 1 ashwagandha product with images
  const { data } = await supabase
    .from('dovive_research')
    .select('asin, title, main_image, images')
    .ilike('title', '%ashwagandha%')
    .not('main_image', 'is', null)
    .limit(1);

  if (!data?.length) { console.log('No products found'); return; }

  const product = data[0];
  console.log('Testing OCR on:', product.asin);
  console.log('Title:', product.title?.slice(0, 60));
  console.log('Image:', product.main_image);

  const worker = await createWorker('eng');

  try {
    console.log('\nRunning Tesseract OCR...');
    const { data: { text, confidence } } = await worker.recognize(product.main_image);
    console.log('\n--- OCR Result ---');
    console.log('Confidence:', confidence.toFixed(1) + '%');
    console.log('Text extracted:');
    console.log(text.slice(0, 1000));
  } catch(e) {
    console.error('OCR Error:', e.message);
  } finally {
    await worker.terminate();
  }
})().catch(e => console.error(e.message));
