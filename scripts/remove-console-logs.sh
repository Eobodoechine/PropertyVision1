#!/bin/bash

# Remove console.log statements from main analysis pipeline to speed up execution
# This script will remove all console.log lines while preserving the logic

echo "🧹 Removing console.log statements from analysis pipeline..."

# Main analysis files
files=(
  "server/step3-find-comparables.ts"
  "server/step4-arv-calculation.ts"
  "server/full-analysis.ts"
  "server/comprehensive-comp-search-v3.ts"
  "server/step1-geocoding.ts"
  "server/step2-property-research.ts"
  "server/storage.ts"
  "server/utils/smartDeduplicator.ts"
  "server/utils/progressiveSearchStrategy.ts"
  "server/utils/propertyDataNormalizer.ts"
  "server/utils/distanceValidator.ts"
)

# Count total before
total_before=0
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    count=$(grep -c "console\.log" "$file" 2>/dev/null || echo 0)
    total_before=$((total_before + count))
    echo "  📄 $file: $count console.log statements"
  fi
done

echo "📊 Total console.log statements found: $total_before"
echo ""

# Remove console.log statements
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "🔧 Cleaning $file..."
    # Remove lines that contain console.log
    sed -i '' '/console\.log/d' "$file"
  fi
done

# Count total after
total_after=0
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    count=$(grep -c "console\.log" "$file" 2>/dev/null || echo 0)
    total_after=$((total_after + count))
  fi
done

echo ""
echo "✅ Cleanup complete!"
echo "📊 Console.log statements removed: $((total_before - total_after))"
echo "📊 Remaining: $total_after"
echo ""
echo "🚀 Your analysis should now run much faster!"