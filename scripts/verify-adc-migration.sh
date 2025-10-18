#!/bin/bash
# ADC Migration Verification Script
# Verifies that all code has been migrated from JSON service account keys to ADC

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 ADC Migration Verification${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ERRORS=0

# Test 1: Check for old auth patterns
echo -e "${BLUE}[1/5] Checking for old service account auth patterns...${NC}"
OLD_AUTH_RESULTS=$(grep -r "sa\.private_key\|sa\.client_email\|getVertexConfig" src \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=archived \
  2>/dev/null || true)

if [ -z "$OLD_AUTH_RESULTS" ]; then
  echo -e "${GREEN}✅ No old auth patterns found${NC}"
else
  echo -e "${RED}❌ Found old auth patterns:${NC}"
  echo "$OLD_AUTH_RESULTS"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Test 2: Verify all vertexGenerate calls use token parameter
echo -e "${BLUE}[2/5] Checking vertexGenerate calls use token parameter...${NC}"
BAD_VERTEX_RESULTS=$(grep -r "vertexGenerate.*sa:" src \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=archived \
  2>/dev/null || true)

if [ -z "$BAD_VERTEX_RESULTS" ]; then
  echo -e "${GREEN}✅ All vertexGenerate calls use token parameter${NC}"
else
  echo -e "${RED}❌ Found vertexGenerate calls with old 'sa' parameter:${NC}"
  echo "$BAD_VERTEX_RESULTS"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Test 3: Verify ADC helper functions are imported where needed
echo -e "${BLUE}[3/5] Verifying ADC helper imports...${NC}"
FILES_WITH_VERTEX=$(grep -r "from.*vertex-freeform" src \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=archived \
  2>/dev/null | cut -d: -f1 | sort -u || echo "")

ADC_IMPORTS_OK=true
for file in $FILES_WITH_VERTEX; do
  if grep -q "import.*vertexGenerate" "$file" 2>/dev/null; then
    # Check if this file also imports ADC helpers
    if ! grep -q "getAccessTokenViaAuth\|resolveProjectId\|resolveLocation" "$file" 2>/dev/null; then
      echo -e "${YELLOW}⚠️  File imports vertexGenerate but not ADC helpers: $file${NC}"
      # Check if it's actually calling vertexGenerate (not just re-exporting)
      if grep -q "vertexGenerate(" "$file" 2>/dev/null; then
        echo -e "${RED}   ❌ File calls vertexGenerate - ADC helpers needed${NC}"
        ADC_IMPORTS_OK=false
        ERRORS=$((ERRORS + 1))
      fi
    fi
  fi
done

if [ "$ADC_IMPORTS_OK" = true ]; then
  echo -e "${GREEN}✅ All files with vertexGenerate calls import ADC helpers${NC}"
fi
echo ""

# Test 4: Check for old project ID in non-guard scripts
echo -e "${BLUE}[4/5] Checking for old project ID references...${NC}"
OLD_PROJECT_REFS=$(grep -r "agile-device-472202-i8" src scripts \
  --include="*.ts" --include="*.js" --include="*.sh" \
  --exclude-dir=node_modules --exclude-dir=archived \
  2>/dev/null | grep -v "ci-guard-old-project.sh" | grep -v "firebase.ts" || echo "")

if [ -z "$OLD_PROJECT_REFS" ]; then
  echo -e "${GREEN}✅ No unexpected old project ID references${NC}"
else
  echo -e "${YELLOW}⚠️  Found old project ID references (review if intentional):${NC}"
  echo "$OLD_PROJECT_REFS"
fi
echo ""

# Test 5: Verify key files were converted
echo -e "${BLUE}[5/5] Verifying key files were converted...${NC}"
KEY_FILES=(
  "src/server/step3-find-comparables.ts"
  "src/server/utils/vertexDeduplicator.ts"
  "src/server/utils/vertexClient.ts"
  "src/server/vertex-details.ts"
  "src/server/comprehensive-comp-search-v3.ts"
)

ALL_FILES_OK=true
for file in "${KEY_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo -e "${YELLOW}⚠️  File not found: $file${NC}"
    continue
  fi

  # Check that file doesn't have old patterns
  if grep -q "sa\.private_key\|getVertexConfig" "$file" 2>/dev/null; then
    echo -e "${RED}❌ File still has old auth: $file${NC}"
    ALL_FILES_OK=false
    ERRORS=$((ERRORS + 1))
  else
    echo -e "${GREEN}✅ $file${NC}"
  fi
done

if [ "$ALL_FILES_OK" = false ]; then
  echo -e "${RED}❌ Some key files were not fully converted${NC}"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$ERRORS" -eq 0 ]; then
  echo -e "${GREEN}✅ All ADC migration checks passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Test locally with ADC: gcloud auth application-default login"
  echo "  2. Deploy to staging: ./scripts/deploy-helper.sh worker staging --image"
  echo "  3. Verify logs and test end-to-end"
  exit 0
else
  echo -e "${RED}❌ ADC migration verification failed with $ERRORS errors${NC}"
  echo ""
  echo "Please fix the issues above before deploying."
  exit 1
fi
