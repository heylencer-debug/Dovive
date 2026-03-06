#!/usr/bin/env python3
"""
Amazon Review Scraper using woot.com AJAX API
Based on the same approach as mrlong0129/amazon-review-scraper
No API key, no login needed.
"""

import urllib.request
import json
import sys
import argparse
import time

def get_reviews(asin, mode='max', sort_orders=None, star_ratings=None):
    """Scrape reviews from woot.com AJAX API"""
    
    if sort_orders is None:
        sort_orders = ['recent', 'helpful', 'oldest']
    if star_ratings is None:
        star_ratings = ['five_star', 'four_star', 'three_star', 'two_star', 'one_star']
    
    # Mode settings
    mode_limits = {
        'basic': 100,
        'full': 500,
        'max': 700
    }
    max_reviews = mode_limits.get(mode, 500)
    
    base_url = f"https://www.woot.com/Reviews/{asin}"
    
    all_reviews = []
    seen_ids = set()
    
    for sort in sort_orders:
        for star in star_ratings:
            if len(all_reviews) >= max_reviews:
                break
                
            url = f"{base_url}?sortBy={sort}&filterByStar={star}"
            
            try:
                req = urllib.request.Request(url)
                req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                req.add_header('Accept', 'application/json')
                req.add_header('Referer', f'https://www.amazon.com/dp/{asin}')
                
                with urllib.request.urlopen(req, timeout=15) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    
                    if 'reviews' in data:
                        for review in data['reviews']:
                            review_id = review.get('Id') or review.get('reviewId')
                            if review_id and review_id not in seen_ids:
                                seen_ids.add(review_id)
                                all_reviews.append(review)
                                
                                if len(all_reviews) >= max_reviews:
                                    break
                    
            except Exception as e:
                print(f"Error fetching {sort}/{star}: {e}", file=sys.stderr)
                continue
            
            time.sleep(0.5)  # Rate limiting
    
    return all_reviews[:max_reviews]

def main():
    parser = argparse.ArgumentParser(description='Amazon Review Scraper')
    parser.add_argument('asin', help='Amazon ASIN (e.g., B0BLCBRBVZ)')
    parser.add_argument('--mode', choices=['basic', 'full', 'max'], default='max',
                        help='Scrape mode: basic (100), full (500), max (~700)')
    parser.add_argument('--output', '-o', help='Output JSON file')
    
    args = parser.parse_args()
    
    print(f"Scraping reviews for {args.asin} (mode: {args.mode})...", file=sys.stderr)
    
    reviews = get_reviews(args.asin, mode=args.mode)
    
    print(f"Got {len(reviews)} reviews", file=sys.stderr)
    
    # Output as JSON
    output = {
        'asin': args.asin,
        'mode': args.mode,
        'total_reviews': len(reviews),
        'reviews': reviews
    }
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f"Saved to {args.output}", file=sys.stderr)
    else:
        print(json.dumps(output, indent=2, ensure_ascii=False))

if __name__ == '__main__':
    main()
