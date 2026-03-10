$keywords = @(
  "lion's mane supplement",
  "lion's mane powder",
  "lion's mane gummies",
  "magnesium gummies",
  "magnesium glycinate",
  "creatine gummies",
  "ashwagandha supplement",
  "berberine supplement",
  "collagen peptides",
  "collagen powder",
  "collagen gummies",
  "berberine gummies",
  "magnesium powder",
  "ashwagandha powder"
)

foreach ($kw in $keywords) {
  Write-Host "`n=== Running Keepa P2 for: $kw ===" -ForegroundColor Cyan
  node keepa-phase2.js "$kw"
  Write-Host "--- Done: $kw ---" -ForegroundColor Green
}

Write-Host "`nAll Keepa P2 runs complete." -ForegroundColor Yellow
