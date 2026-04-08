#!/bin/bash
# DataForge — Publish Worker Node to public repo
# Usage: bash scripts/publish-worker.sh
# Auto-increments version tag (v1.0.0 → v1.0.1 → v1.0.2 ...)

set -e

echo "=== Publishing DataForge Worker Node ==="

# Get latest worker tag
LATEST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)

if [ -z "$LATEST_TAG" ]; then
  NEW_TAG="v1.0.0"
else
  # Parse version: v1.0.0 → 1 0 0
  VERSION=${LATEST_TAG#v}
  MAJOR=$(echo "$VERSION" | cut -d. -f1)
  MINOR=$(echo "$VERSION" | cut -d. -f2)
  PATCH=$(echo "$VERSION" | cut -d. -f3)

  # Increment patch
  PATCH=$((PATCH + 1))
  NEW_TAG="v${MAJOR}.${MINOR}.${PATCH}"
fi

echo "Previous: ${LATEST_TAG:-none}"
echo "New:      $NEW_TAG"
echo ""

# Split subtree
echo "[1/4] Splitting worker-node subtree..."
git subtree split --prefix=worker-node -b worker-tmp

# Create clean orphan commit
echo "[2/4] Creating clean commit..."
git checkout worker-tmp
git checkout --orphan worker-push
git commit -m "DataForge Worker Node $NEW_TAG"

# Force push to worker remote
echo "[3/4] Pushing to worker remote..."
git push worker worker-push:main --force

# Create and push tag
echo "[4/4] Tagging $NEW_TAG..."
git tag "$NEW_TAG"
git push worker "$NEW_TAG"

# Cleanup
git checkout main
git branch -D worker-tmp worker-push

echo ""
echo "=== Done! ==="
echo "Published: $NEW_TAG"
echo "Image will build: ghcr.io/dvernoff/dataforge-worker:$NEW_TAG"
