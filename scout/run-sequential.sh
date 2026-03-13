#!/bin/bash
# run-sequential.sh — runs two pipelines back-to-back
# Usage: bash run-sequential.sh "keyword1" "keyword2" --from P7 --force

KW1="$1"
KW2="$2"
shift 2
EXTRA_ARGS="$@"

echo "=== Running pipeline for: $KW1 ==="
cd /root/dovive/scout
node run-pipeline.js --keyword "$KW1" $EXTRA_ARGS
echo "=== Done: $KW1. Starting: $KW2 ==="
rm -f /root/dovive/scout/.pipeline-lock-*
node run-pipeline.js --keyword "$KW2" $EXTRA_ARGS
echo "=== Both pipelines complete ==="
