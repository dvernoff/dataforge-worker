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

# Split subtree into a temp branch
Write-Host "[1/4] Splitting worker-node subtree..." -ForegroundColor Yellow
git subtree split --prefix=worker-node -b worker-tmp 2>&1 | Out-Null
Write-Host "       Done."

# Create orphan commit from that branch's tree
Write-Host "[2/4] Creating clean orphan commit..." -ForegroundColor Yellow
$treeHash = git log worker-tmp -1 --format="%T"
$commitHash = git commit-tree $treeHash -m "DataForge Worker Node $newTag"
Write-Host "       Commit: $commitHash"

# Force push to worker remote
Write-Host "[3/4] Pushing to worker remote..." -ForegroundColor Yellow
git push worker "${commitHash}:main" --force 2>&1 | ForEach-Object { Write-Host "       $_" }

# Create and push tag on worker remote
Write-Host "[4/4] Tagging $newTag..." -ForegroundColor Yellow
git tag -f $newTag $commitHash 2>&1 | Out-Null
git push worker $newTag --force 2>&1 | ForEach-Object { Write-Host "       $_" }

# Cleanup
git branch -D worker-tmp 2>&1 | Out-Null

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "Published: $newTag"
Write-Host "Image will build: ghcr.io/dvernoff/dataforge-worker:$newTag"
