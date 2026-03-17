require('dotenv').config();
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const KEYWORD = process.argv[2] || 'melatonin gummies';
const LIMIT = Number(process.argv[3] || 12); // token-safe batch
const MAX_IMAGES = Number(process.argv[4] || 3);

const DOV = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const OPENAI_KEY = process.env.OPENAI_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function resolveCategory(keyword) {
  const words = keyword.toLowerCase().split(' ');
  const { data: cats } = await DASH.from('categories').select('id,name').ilike('name', `%${words[0]}%`).limit(30);
  const scored = (cats || []).map(c => ({ ...c, score: words.filter(w => c.name.toLowerCase().includes(w)).length }))
    .filter(c => c.score >= words.length)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) throw new Error('Category not found');
  return scored[0].id;
}

async function callVision(imageUrl, asin, title) {
  const prompt = `Extract supplement facts from this product image. Return ONLY JSON with fields: has_supplement_facts(boolean), serving_size, servings_per_container, supplement_facts([{name,amount,dv_percent}]), other_ingredients, health_claims(array), certifications(array), raw_text.`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 700,
      messages: [{ role: 'user', content: [{ type: 'text', text: `${prompt}\nASIN:${asin}\nTitle:${title}` }, { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }] }]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  const txt = data.choices?.[0]?.message?.content || '{}';
  const m = txt.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : txt);
}

(async () => {
  if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY');

  const cat = await resolveCategory(KEYWORD);
  const { data: miss } = await DASH.from('products').select('asin,title,image_urls,main_image_url').eq('category_id', cat).is('supplement_facts_raw', null);
  const missing = miss || [];
  const asins = missing.map(x => x.asin);

  const { data: existing } = await DOV.from('dovive_ocr').select('asin').eq('keyword', KEYWORD).in('asin', asins);
  const hasAny = new Set((existing || []).map(r => r.asin));
  const targets = missing.filter(p => !hasAny.has(p.asin)).slice(0, LIMIT);

  console.log(`Missing P4: ${missing.length} | No OCR rows: ${targets.length} (processing batch limit ${LIMIT})`);

  let saved = 0, failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    const imgs = (Array.isArray(p.image_urls) ? p.image_urls : []).filter(Boolean);
    if (p.main_image_url && !imgs.includes(p.main_image_url)) imgs.unshift(p.main_image_url);
    const useImgs = imgs.slice(0, MAX_IMAGES);
    if (!useImgs.length) continue;

    console.log(`[${i + 1}/${targets.length}] ${p.asin} imgs:${useImgs.length}`);

    for (let idx = 0; idx < useImgs.length; idx++) {
      try {
        const parsed = await callVision(useImgs[idx], p.asin, p.title || '');
        const facts = Array.isArray(parsed.supplement_facts) && parsed.supplement_facts.length ? parsed.supplement_facts : null;
        await DOV.from('dovive_ocr').upsert({
          asin: p.asin,
          keyword: KEYWORD,
          image_url: useImgs[idx],
          image_index: idx,
          serving_size: parsed.serving_size || null,
          servings_per_container: parsed.servings_per_container || null,
          supplement_facts: facts,
          other_ingredients: parsed.other_ingredients || null,
          health_claims: Array.isArray(parsed.health_claims) && parsed.health_claims.length ? parsed.health_claims : null,
          certifications: Array.isArray(parsed.certifications) && parsed.certifications.length ? parsed.certifications : null,
          raw_text: parsed.raw_text || null,
          gpt_model: 'gpt-4o',
          processed_at: new Date().toISOString()
        }, { onConflict: 'asin,image_index' });

        // If facts exist, also write a text-extract marker row (image_index=99) so migrate-ocr-to-dash reliably picks this ASIN.
        if (facts) {
          await DOV.from('dovive_ocr').upsert({
            asin: p.asin,
            keyword: KEYWORD,
            image_url: null,
            image_index: 99,
            serving_size: parsed.serving_size || null,
            servings_per_container: parsed.servings_per_container || null,
            supplement_facts: facts,
            other_ingredients: parsed.other_ingredients || null,
            health_claims: Array.isArray(parsed.health_claims) && parsed.health_claims.length ? parsed.health_claims : null,
            certifications: Array.isArray(parsed.certifications) && parsed.certifications.length ? parsed.certifications : null,
            raw_text: parsed.raw_text || null,
            gpt_model: 'gpt-4o',
            processed_at: new Date().toISOString()
          }, { onConflict: 'asin,image_index' });
        }
        saved++;
      } catch (e) {
        failed++;
      }
      await sleep(1200);
    }
  }

  console.log({ saved, failed });
})();
