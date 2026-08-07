import { createHash } from 'node:crypto';

export function getManagedWorkspaceName(
  repoName: string,
  branch: string
): string {
  return `${repoName}@${branch.replace(/\//g, '-')}`;
}

export function getCollisionSafeManagedWorkspaceName(
  repoName: string,
  branch: string
): string {
  const suffix = createHash('sha256').update(branch).digest('hex').slice(0, 12);
  return `${getManagedWorkspaceName(repoName, branch)}~${suffix}`;
}
