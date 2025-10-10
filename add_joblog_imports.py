#!/usr/bin/env python3
import os
import re

server_dir = "src/server"

for root, dirs, files in os.walk(server_dir):
    for filename in files:
        if not (filename.endswith('.ts') or filename.endswith('.js')):
            continue

        filepath = os.path.join(root, filename)

        with open(filepath, 'r') as f:
            content = f.read()

        # Skip if no jobLog usage
        if 'jobLog(' not in content:
            continue

        # Skip if already has jobLog import
        if 'jobLog' in content and ('from' in content and 'jobQueue' in content):
            if re.search(r'import.*jobLog.*from.*jobQueue', content):
                print(f"✓ {filepath} already has jobLog import")
                continue

        # Calculate relative path
        depth = filepath.count(os.sep) - server_dir.count(os.sep)
        rel_path = '../' * (depth - 1) if depth > 1 else './'

        lines = content.split('\n')
        modified = False

        # Check if file already imports from jobQueue
        for i, line in enumerate(lines):
            if 'from' in line and 'jobQueue' in line and 'import' in line:
                # Add jobLog to existing import
                if 'jobLog' not in line:
                    line = line.replace('import {', 'import { jobLog,')
                    lines[i] = line
                    modified = True
                    print(f"→ Added jobLog to existing import in {filepath}")
                break
        else:
            # Add new import after last import
            last_import_idx = -1
            for i, line in enumerate(lines):
                if line.strip().startswith('import '):
                    last_import_idx = i

            if last_import_idx >= 0:
                import_line = f"import {{ jobLog }} from '{rel_path}utils/jobQueue';"
                lines.insert(last_import_idx + 1, import_line)
                modified = True
                print(f"→ Added new jobLog import to {filepath}")

        if modified:
            with open(filepath, 'w') as f:
                f.write('\n'.join(lines))

print("\n✅ Done!")
