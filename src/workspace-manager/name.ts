export function getManagedWorkspaceName(
  repoName: string,
  branch: string
): string {
  return `${repoName}@${branch.replace(/\//g, '-')}`;
}
