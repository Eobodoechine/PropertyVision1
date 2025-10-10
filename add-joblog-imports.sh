#!/bin/bash

# Add jobLog imports to all files that use jobLog but don't already import it

cd "$(dirname "$0")"

for file in $(grep -l "jobLog(" src/server --include="*.ts" --include="*.js" -r); do
  # Skip if already imports jobLog
  if grep -q "import.*jobLog" "$file" ||  grep -q "jobLog.*from.*jobQueue" "$file"; then
    echo "✓ $file already has jobLog import"
    continue
  fi

  # Check if file already imports from jobQueue
  if grep -q "from.*jobQueue" "$file" || grep -q "from.*utils/jobQueue" "$file" || grep -q "from './utils/jobQueue'" "$file"; then
    echo "→ Adding jobLog to existing import in $file"
    # Add jobLog to existing import
    sed -i '' 's/} from.*jobQueue/& jobLog&/' "$file"
    sed -i '' 's/import { /import { jobLog, /' "$file"
  else
    # Add new import at top of file (after existing imports)
    echo "→ Adding new jobLog import to $file"

    # For TypeScript files
    if [[ $file == *.ts ]]; then
      # Find last import line and add after it
      last_import=$(grep -n "^import" "$file" | tail -1 | cut -d: -f1)
      if [[ -n $last_import ]]; then
        # Calculate relative path to jobQueue
        depth=$(echo "$file" | tr -cd '/' | wc -c)
        rel_path=$(printf '../%.0s' $(seq 1 $((depth - 2))))
        sed -i '' "${last_import}a\\
import { jobLog } from '${rel_path}utils/jobQueue';
" "$file"
      fi
    fi

    # For JavaScript files
    if [[ $file == *.js ]]; then
      # Find last import/require and add after it
      last_import=$(grep -n "^import\|^const.*require" "$file" | tail -1 | cut -d: -f1)
      if [[ -n $last_import ]]; then
        depth=$(echo "$file" | tr -cd '/' | wc -c)
        rel_path=$(printf '../%.0s' $(seq 1 $((depth - 2))))
        sed -i '' "${last_import}a\\
import { jobLog } from '${rel_path}utils/jobQueue.js';
" "$file"
      fi
    fi
  fi
done

echo ""
echo "✅ Done! Added jobLog imports to all files"
