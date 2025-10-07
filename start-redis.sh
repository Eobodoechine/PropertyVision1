#!/bin/bash

# Start local Redis for testing
# Run this in your Terminal (not through Claude)

docker run -d --name propertyvision-redis-local -p 6379:6379 redis:7-alpine

echo "✅ Redis started on localhost:6379"
echo ""
echo "Next steps:"
echo "1. Update frontend/.env.local:"
echo "   REDIS_URL=redis://localhost:6379"
echo ""
echo "2. Restart dev server:"
echo "   cd frontend && npm run dev"
echo ""
echo "3. Test:"
echo "   cd frontend && ./test-progress-api.sh"
