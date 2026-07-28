---
description: Check package repositories for local changes and synchronization state
argument-hint: "<package-path> [additional-package-paths...]"
---

Perform a read-only repository-state check for the exact package paths in `$@`.

For each package, report:

- current branch and configured upstream;
- staged, unstaged, deleted, and untracked files;
- active merge, rebase, cherry-pick, revert, or bisect state;
- commits ahead of and behind the upstream;
- local commits not present upstream;
- whether `HEAD` is present on the upstream;
- configured remotes;
- tags pointing at `HEAD`;
- package version and npm `latest` version when a manifest and registry evidence are available.

Refresh remote evidence when needed to avoid presenting stale synchronization state as current. If fetch or registry lookup is unavailable, report uncertainty rather than inferring synchronization.

Do not stage, commit, reset, clean, switch branches, pull, merge, rebase, push, tag, publish, or modify files.

Classify each package as one of:

- clean and synchronized;
- clean but unpushed;
- locally modified;
- behind upstream;
- diverged;
- unknown because required evidence was unavailable.

Return a compact package-by-package table followed by actionable details. Do not broaden the check to unspecified sibling repositories.
