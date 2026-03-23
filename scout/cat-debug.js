const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function getCategoryId(keyword) {
  const words = keyword.toLowerCase().split(' ');
  const { data: cats } = await DASH.from('categories').select('id,name').ilike('name', `%${words[0]}%`).limit(30);
  if (!cats?.length) return null;

  const scored = cats.map(c => {
    const lower = c.name.toLowerCase();
    const score = words.filter(w => lower.includes(w)).length;
    return { ...c, score };
  }).filter(c => c.score >= words.length).sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  const topScore = scored[0].score;
  const tied = scored.filter(c => c.score === topScore);

  if (tied.length === 1) return tied[0].id;

  const withCounts = await Promise.all(tied.map(async c => {
    const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
    return { ...c, count: count || 0 };
  }));

  withCounts.sort((a, b) => b.count - a.count);
  return withCounts[0].id;
}

(async()=>{
  const k='probiotic gummies';
  const id=await getCategoryId(k);
  console.log('category',id);
})();
