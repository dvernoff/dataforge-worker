# DataForge — Publish Worker Node to public repo
# Usage: .\scripts\publish-worker.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Publishing DataForge Worker Node ===" -ForegroundColor Cyan

$latestTag = git tag -l "v*" --sort=-v:refname | Select-Object -First 1

if (-not $latestTag) {
    $newTag = "v1.0.0"
} else {
    $parts = $latestTag.TrimStart('v').Split('.')
    $patch = [int]$parts[2] + 1
    $newTag = "v$($parts[0]).$($parts[1]).$patch"
}

Write-Host "Previous: $(if ($latestTag) { $latestTag } else { 'none' })"
Write-Host "New:      $newTag`n"

Write-Host "[1/4] Splitting worker-node subtree..." -ForegroundColor Yellow
git subtree split --prefix=worker-node -b worker-tmp

Write-Host "[2/4] Creating clean commit..." -ForegroundColor Yellow
git checkout worker-tmp
git checkout --orphan worker-push
git commit -m "DataForge Worker Node $newTag"

Write-Host "[3/4] Pushing to worker remote..." -ForegroundColor Yellow
git push worker worker-push:main --force

Write-Host "[4/4] Tagging $newTag..." -ForegroundColor Yellow
git tag $newTag
git push worker $newTag

git checkout main
git branch -D worker-tmp worker-push

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "Published: $newTag"
Write-Host "Image will build: ghcr.io/dvernoff/dataforge-worker:$newTag"
