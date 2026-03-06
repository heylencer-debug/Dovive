const fetch = require('node-fetch');
fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer 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',
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://heylencer-debug.github.io/Dovive',
    'X-Title': 'Dovive Scout'
  },
  body: JSON.stringify({
    model: 'anthropic/claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
    max_tokens: 10
  })
}).then(r => r.json()).then(d => console.log(JSON.stringify(d))).catch(console.error);
