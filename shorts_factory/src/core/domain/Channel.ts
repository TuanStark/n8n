export interface ChannelCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  dailyQuotaLimit: number;
  quotaUnitsUsedToday: number;
  quotaResetAt: Date;
}

export interface Channel {
  id: string; // e.g. 'channel_01_paper', 'channel_02_tech', 'channel_03_stoic'
  name: string;
  genreKey: string;
  description?: string;
  defaultPrivacy: 'private' | 'unlisted' | 'public';
  defaultTags: string[];
  isActive: boolean;
  credentials?: ChannelCredentials;
  createdAt: Date;
  updatedAt: Date;
}
