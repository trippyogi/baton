#!/usr/bin/env bash
# Test script — sends a signed check_suite.completed payload to the webhook endpoint

WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:4200/api/webhook/github}"
SECRET="${GITHUB_WEBHOOK_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "ERROR: GITHUB_WEBHOOK_SECRET not set" >&2
  exit 1
fi

# Compact JSON — must match byte-for-byte for HMAC to validate
PAYLOAD=$(python3 -c "import json; print(json.dumps({'action':'completed','check_suite':{'conclusion':'failure','head_branch':'circuit/test-job-id','id':'test-check-suite-id'},'repository':{'full_name':'trippyogi/vector-mission-control'}}, separators=(',', ':')))")

SIG="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"

echo "Sending to: $WEBHOOK_URL"
echo "Payload:    $PAYLOAD"
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$PAYLOAD" \
  "$WEBHOOK_URL"
echo ""
