# DataForge — Publish Worker Node to public repo
# Usage: .\scripts\publish-worker.ps1

Write-Host "=== Publishing DataForge Worker Node ===" -ForegroundColor Cyan

# Ensure we're on main
$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
    Write-Host "ERROR: Must be on main branch (currently on $branch)" -ForegroundColor Red
    exit 1
}

# Check for uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Host "ERROR: Uncommitted changes detected. Commit or stash first." -ForegroundColor Red
    exit 1
}

# Get latest worker tag
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

# Split subtree
Write-Host "[1/4] Splitting worker-node subtree..." -ForegroundColor Yellow
$splitHash = git subtree split --prefix=worker-node 2>&1 | Select-Object -Last 1
Write-Host "       Split commit: $splitHash"

# Create orphan branch with single commit
Write-Host "[2/4] Creating clean orphan commit..." -ForegroundColor Yellow
git checkout $splitHash 2>&1 | Out-Null
git checkout --orphan worker-push 2>&1 | Out-Null
git commit -m "DataForge Worker Node $newTag" 2>&1 | Out-Null

# Force push to worker remote
Write-Host "[3/4] Pushing to worker remote..." -ForegroundColor Yellow
git push worker worker-push:main --force 2>&1 | ForEach-Object { Write-Host "       $_" }

# Create and push tag on worker remote
Write-Host "[4/4] Tagging $newTag..." -ForegroundColor Yellow
git tag $newTag 2>&1 | Out-Null
git push worker $newTag 2>&1 | ForEach-Object { Write-Host "       $_" }

# Cleanup
git checkout main 2>&1 | Out-Null
git branch -D worker-push 2>&1 | Out-Null

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "Published: $newTag"
Write-Host "Image will build: ghcr.io/dvernoff/dataforge-worker:$newTag"
