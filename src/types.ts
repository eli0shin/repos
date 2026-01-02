export type RepoEntry = {
  name: string;
  url: string;
  branch: string;
};

export type ReposConfig = {
  repos: RepoEntry[];
};

export type OperationResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type Platform = 'darwin' | 'linux';
export type Architecture = 'x64' | 'arm64';
