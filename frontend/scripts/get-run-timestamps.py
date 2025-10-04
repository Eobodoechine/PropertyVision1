#!/usr/bin/env python3
"""
Get start/end timestamps for production analysis runs.

Usage:
    python3 scripts/get-run-timestamps.py                    # Latest run
    python3 scripts/get-run-timestamps.py "185 Jordan Pl"    # Specific address
    python3 scripts/get-run-timestamps.py --all 5             # Last 5 runs
"""

import json
import subprocess
import sys
from datetime import datetime, timedelta

def get_run_timestamps(address_filter=None, limit=1):
    # Build query
    query = 'resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-frontend AND textPayload:"Search completed"'
    if address_filter:
        query += f' AND textPayload:"{address_filter}"'

    # Get logs
    result = subprocess.run([
        'gcloud', 'logging', 'read', query,
        '--limit', str(limit),
        '--format', 'json',
        '--project', 'agile-device-472202-i8'
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error: {result.stderr}", file=sys.stderr)
        return

    data = json.loads(result.stdout)
    if not data:
        print("No runs found matching the criteria.")
        return

    print("=" * 80)
    for idx, log_entry in enumerate(data, 1):
        try:
            text_payload = json.loads(log_entry['textPayload'].split('Search completed ')[1])

            end_time_str = text_payload['timestamp']
            execution_ms = text_payload['executionTimeMs']
            address = text_payload['address']

            end_time = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))
            start_time = end_time - timedelta(milliseconds=execution_ms)

            if limit > 1:
                print(f"\nRUN #{idx}: {address}")
                print("-" * 80)

            print(f"START:    {start_time.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]} UTC")
            print(f"END:      {end_time.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]} UTC")
            print(f"DURATION: {execution_ms / 1000:.2f} seconds ({int(execution_ms / 60000)}m {int((execution_ms % 60000) / 1000)}s)")
            print()
            print(f"ARV:      ${text_payload.get('arv', 0):,}")
            print(f"Comps:    {text_payload.get('compsCount', 0)} total, {text_payload.get('qualifiedCompsCount', 0)} qualified")
            print(f"Success:  {text_payload.get('success', False)}")

            if limit > 1 and idx < len(data):
                print("=" * 80)
        except Exception as e:
            print(f"Error parsing run #{idx}: {e}", file=sys.stderr)

    print("=" * 80)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == '--all':
            limit = int(sys.argv[2]) if len(sys.argv) > 2 else 5
            get_run_timestamps(limit=limit)
        else:
            get_run_timestamps(address_filter=sys.argv[1])
    else:
        get_run_timestamps()
