export interface User {
  uuid: string;
  username: string;
  pinHash: string;
  createdAt: string;
}

export interface Tab {
  uuid: string;
  userId: string;
  name: string;
  description: string;
  isSensitive: number; // 0 or 1 in SQLite
  tabPinHash?: string | null;
  createdAt: string;
}

export interface Document {
  id?: number;
  tabId: string;
  title: string;
  type: string;
  encryptedContent: string;
  createdAt: string;
}
