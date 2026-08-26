/**
 * Repository allowlist. Fail closed: a repo not explicitly listed is denied,
 * no partial or fuzzy matching. This mirrors authority-model.md's "unknown
 * intent MUST fail closed" for the one boundary this companion owns.
 */
export function isRepoAllowed(repo, allowedRepos) {
  if (typeof repo !== "string" || repo.length === 0) return false;
  return allowedRepos.includes(repo);
}

export function assertRepoAllowed(repo, allowedRepos) {
  if (!isRepoAllowed(repo, allowedRepos)) {
    const err = new Error(`Repository is not on the allowlist: ${String(repo)}`);
    err.code = "REPO_NOT_ALLOWED";
    throw err;
  }
}
