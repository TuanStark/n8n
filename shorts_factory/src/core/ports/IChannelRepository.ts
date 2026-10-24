import { Channel } from '../domain/Channel';
import { GenreProfile } from '../domain/GenreProfile';

export interface IChannelRepository {
  getChannelById(channelId: string): Promise<Channel | null>;
  listActiveChannels(): Promise<Channel[]>;
  getGenreProfile(genreKey: string): Promise<GenreProfile>;
  listGenreProfiles(): Promise<GenreProfile[]>;
  saveChannel(channel: Partial<Channel>): Promise<void>;
  updateQuotaUsed(channelId: string, unitsAdded: number): Promise<void>;
}
