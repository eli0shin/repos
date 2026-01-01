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
