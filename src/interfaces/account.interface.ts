export interface Account {
  id: string;
  status: AccountStatus;

  username: string;
  password: string;
  secret?: string | null;
}

export enum AccountStatus {
  Active = 'active',
  Banned = 'banned',
  Limited = 'limited',
  Unknown = 'unknown',
}
