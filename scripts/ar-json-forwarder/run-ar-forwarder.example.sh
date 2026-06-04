#!/bin/sh

export AR_SYNC_ENDPOINT="https://your-cloudbase-endpoint/ar/import"
export AR_SYNC_TOKEN="your-token-here"
export AR_JSON_PATH="/path/to/ar-sync-latest.json"
export AR_MIN_SUMMARY_COUNT="50"
export AR_SYNC_STATE_PATH="/path/to/sync-state.json"
export AR_SYNC_TIMEOUT_MS="30000"
export AR_SYNC_INTERVAL_MS="60000"

node "$(dirname "$0")/forward-ar-json.js" --once
