export type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type WorktreeInfo = {
  path: string;
  branch: string;
  isMain: boolean;
};

export type BranchUpstreamStatus = 'gone' | 'tracking' | 'local';

export type CommitInfo = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
};
