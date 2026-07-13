#!/bin/bash
# Start script for Railway - seeds DB first, then starts server

echo "=== Serafimoski Tek ERP - Starting ==="

# Run database migrations and seeds
echo "Seeding database..."
npx tsx db/seed-defaults.ts 2>/dev/null || echo "Seed defaults skipped (may already exist)"
npx tsx db/seed-metalnet.ts 2>/dev/null || echo "Seed metalnet skipped (may already exist)"

echo "Starting server..."
# Start the actual server
npm start
