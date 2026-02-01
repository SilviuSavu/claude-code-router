# Pre-Push Security Checklist

Before pushing this repo to GitHub, complete these steps:

## ✅ Files to Check

- [x] `.gitignore` created (excludes config.json, logs, .claude.json)
- [x] `config.example.json` created (sanitized template)
- [x] `SOLUTION.md` sanitized (no API keys)
- [x] `README.md` created (setup instructions)
- [ ] `config.json` - **DO NOT COMMIT** (contains real API key)
- [ ] `.claude.json` - **DO NOT COMMIT** (contains real API key)
- [ ] `logs/` directory - **DO NOT COMMIT** (may contain keys)
- [ ] `*.bak` files - **DO NOT COMMIT** (may contain keys)

## 🔒 Files Safe to Commit

✅ These files are sanitized and safe:
- `README.md`
- `SOLUTION.md`
- `WEB_SEARCH_INVESTIGATION.md`
- `config.example.json`
- `.gitignore`
- `plugins/glm47-transformer/` (all files)
- `PUSH_CHECKLIST.md` (this file)

## 🚨 Commands to Run

### 1. Initialize Git (if not already done)

```bash
cd ~/.claude-code-router
git init
git add .gitignore
```

### 2. Verify .gitignore is working

```bash
# This should NOT show config.json or logs/
git status
```

### 3. Check for exposed keys

```bash
# Run this and verify no output (replace YOUR_KEY_PREFIX with first 8 chars of your key):
git grep -i "YOUR_KEY_PREFIX" 2>/dev/null || echo "✅ No keys found in git-tracked files"
```

### 4. Add safe files only

```bash
git add README.md
git add SOLUTION.md
git add WEB_SEARCH_INVESTIGATION.md
git add config.example.json
git add .gitignore
git add plugins/
git add PUSH_CHECKLIST.md
```

### 5. Verify what will be committed

```bash
# Review carefully:
git status
git diff --staged
```

### 6. Commit and push

```bash
git commit -m "feat: CCR + Z.AI GLM-4.7 with working MCP web search

- Configure Z.AI OpenAI endpoint with GLM47 transformer
- Preserve MCP tools in transformer
- Enable web search through MCP server
- Full 15+ hour investigation documented"

# Create repo on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## 🔍 Final Verification

After pushing, check GitHub:

1. **View the repository files online**
2. **Search the repo for your API key**: Use GitHub's search with your key prefix
3. **Check commit history**: Make sure no keys in any commit
4. **If you find exposed keys**:
   - **IMMEDIATELY rotate your Z.AI API key** at https://z.ai
   - Use `git filter-branch` or BFG Repo-Cleaner to remove from history
   - Force push the cleaned history

## ⚠️ If You Accidentally Exposed Your Key

1. **Rotate the key immediately** at https://z.ai/api-keys
2. **Clean git history**:
   ```bash
   # Install BFG Repo-Cleaner
   brew install bfg  # or download from https://rtyley.github.io/bfg-repo-cleaner/

   # Remove the key from all commits
   bfg --replace-text <(echo "YOUR_ACTUAL_API_KEY_HERE==>YOUR_Z_AI_API_KEY_HERE")

   # Clean up
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive

   # Force push
   git push --force
   ```

## 📋 Environment Variables (Optional Enhancement)

For even better security, use environment variables:

Create `.env`:
```bash
Z_AI_API_KEY=your_key_here
```

Update config to use env vars:
```javascript
// In config.json, use a script to populate from .env
// Or use CCR's environment variable support if available
```

---

**Remember**: Once a secret is in git history, assume it's compromised. Always rotate keys if accidentally committed!
