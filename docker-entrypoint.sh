#!/bin/sh

if [ "$RUN_WORKER" = "true" ]; then
  echo "Starting worker..."
  npm run worker
else
  echo "Starting web server..."
  npm start
fi
