# How to push to GitHub

## 1. Create repositories on GitHub

Go to https://github.com/new and create:

- `dataforge` — **Private** (main monorepo: CP + shared)
- `dataforge-worker` — **Public** (worker node, open-source)
- `dataforge-site` — **Private** (landing page)

## 2. Push main repo (dataforge — private)

```bash
cd C:\Users\autht\OneDrive\Desktop\BASE\Github\dataforge

# Init if not already a git repo
git init
git add .
git commit -m "Initial commit"

# Add remote and push
git remote add origin https://github.com/YOUR_USERNAME/dataforge.git
git branch -M main
git push -u origin main
```

## 3. Push worker as separate public repo

Worker lives inside the monorepo but needs its own public repo.
Use `git subtree` to split it out:

```bash
# From the monorepo root
cd C:\Users\autht\OneDrive\Desktop\BASE\Github\dataforge

# Add worker remote
git remote add worker https://github.com/YOUR_USERNAME/dataforge-worker.git

# Push worker-node/ folder as its own repo
git subtree push --prefix=worker-node worker main
```

To update worker repo later after changes:
```bash
git subtree push --prefix=worker-node worker main
```

## 4. Push site as separate repo

```bash
cd C:\Users\autht\OneDrive\Desktop\BASE\Github\dataforge

git remote add site https://github.com/YOUR_USERNAME/dataforge-site.git
git subtree push --prefix=dataforge-site site main
```

## 5. Create first release

```bash
# In main repo
git tag v0.1.0
git push origin v0.1.0

# In worker repo (after subtree push)
cd /tmp && git clone https://github.com/YOUR_USERNAME/dataforge-worker.git
cd dataforge-worker
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions will automatically:
- Build Docker images
- Push to ghcr.io
- Create GitHub Release with changelog

## 6. After release — update Worker README

Replace `YOUR_ORG` in `worker-node/README.md` with your actual GitHub username/org.

## Quick reference

| Repo | Visibility | Contains |
|------|-----------|----------|
| `dataforge` | Private | CP backend, CP frontend, shared types, docker-compose |
| `dataforge-worker` | Public | Worker node, Dockerfile, install scripts |
| `dataforge-site` | Private | Astro landing page |
