require('dotenv').config();
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const D = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
  const asin = process.argv[2] || 'B00NMFUWIU';
  const kw = process.argv[3] || 'melatonin gummies';

  const { data: p } = await D.from('dovive_research').select('title,images').eq('keyword', kw).eq('asin', asin).single();
  const img = (Array.isArray(p?.images) ? p.images : [])[0];
  if (!img) throw new Error('No image found in source');

  const prompt = 'Extract supplement facts from image. Return JSON only with has_supplement_facts, serving_size, servings_per_container, supplement_facts[{name,amount,dv_percent}], other_ingredients, health_claims, certifications, raw_text.';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `ASIN:${asin}\n${prompt}` },
          { type: 'image_url', image_url: { url: img, detail: 'high' } }
        ]
      }]
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }

  const j = await res.json();
  const c = j.choices?.[0]?.message?.content || '{}';
  const m = c.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m ? m[0] : c);

  console.log(parsed);

  if (Array.isArray(parsed.supplement_facts) && parsed.supplement_facts.length) {
    await D.from('dovive_ocr').upsert({
      asin,
      keyword: kw,
      image_url: img,
      image_index: 99,
      serving_size: parsed.serving_size || null,
      servings_per_container: parsed.servings_per_container || null,
      supplement_facts: parsed.supplement_facts,
      other_ingredients: parsed.other_ingredients || null,
      health_claims: Array.isArray(parsed.health_claims) ? parsed.health_claims : null,
      certifications: Array.isArray(parsed.certifications) ? parsed.certifications : null,
      raw_text: parsed.raw_text || null,
      gpt_model: 'gpt-4o',
      processed_at: new Date().toISOString()
    }, { onConflict: 'asin,image_index' });
    console.log('saved');
  } else {
    console.log('no_facts');
  }
})();
