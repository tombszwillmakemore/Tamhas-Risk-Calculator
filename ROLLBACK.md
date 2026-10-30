# Rollback: restoring the previous working version

GitHub Pages serves the `main` branch. Every merge to `main` is preceded by a backup branch (`backup-main-before-<name>`), and each merge is a single merge commit, so reverting is quick. User data lives in each person's browser and is never changed by a deploy or a rollback.

## Fast rollback (recommended)
1. Find the bad merge: `git log --first-parent --oneline main | head`.
2. Revert it as a new commit (keeps history, safe to push): `git revert -m 1 <merge-commit> && git push origin main`.
3. Pages redeploys in about a minute. The service worker is network-first, so people get the restored files on their next launch; a running app shows the "Update ready" bar.
4. Confirm on the live site: Help shows the previous version number; open the main tabs.

## Alternative: reset to the backup branch
Only if the revert is not enough and the owner agrees: `git checkout main && git reset --hard backup-main-before-<name> && git push --force-with-lease origin main`.
Force-pushing rewrites history; never do it without the owner's approval.

## Bump the cache after a rollback
If rolled-back files differ from what browsers cached, bump `CACHE` in `sw.js` (for example `tt-app-v5`) in a follow-up commit so installed apps refresh their offline copy.

## Data safety during incidents
- Do not ask people to clear site data. Their trades live there.
- If someone is stuck: Journal > Backup > download a backup first, then reload.
- If stored settings seem corrupt: the app falls back to defaults automatically; Help > Report a problem collects non-sensitive diagnostics.

## Find the last good release
`git tag` marks releases; `RELEASES` in `assets/registry-core.js` lists versions. Backup branches: `git branch -a | grep backup-main-before`.
