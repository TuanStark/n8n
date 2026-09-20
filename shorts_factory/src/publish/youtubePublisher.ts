import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { pool } from '../db/pool';

export interface YouTubeUploadMetadata {
  title: string;
  description: string;
  category: string;
  tags?: string[];
  privacyStatus?: 'private' | 'unlisted' | 'public';
  channelName?: string;
}

export interface YouTubeUploadResult {
  videoId: string;
  youtubeUrl: string;
  title: string;
  privacyStatus: string;
}

export interface ChannelCredentialsInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class YouTubePublisher {
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private channelId?: string;

  constructor(creds?: Partial<ChannelCredentialsInput>, channelId?: string) {
    this.clientId = creds?.clientId || config.youtube.clientId;
    this.clientSecret = creds?.clientSecret || config.youtube.clientSecret;
    this.refreshToken = creds?.refreshToken || config.youtube.refreshToken;
    this.channelId = channelId;
  }

  /**
   * Factory method to load dynamic credentials for a specific channel from DB or ENV
   */
  public static async forChannel(channelId: string): Promise<YouTubePublisher> {
    try {
      // 1. Query database credentials for this channel
      const res = await pool.query(
        'SELECT client_id, client_secret, refresh_token FROM channel_credentials WHERE channel_id = $1',
        [channelId]
      );

      if (res.rows.length > 0 && res.rows[0].refresh_token) {
        const row = res.rows[0];
        console.log(`[YouTubePublisher] Loaded credentials for channel "${channelId}" from database.`);
        return new YouTubePublisher(
          {
            clientId: row.client_id,
            clientSecret: row.client_secret,
            refreshToken: row.refresh_token,
          },
          channelId
        );
      }

      // 2. Check channel-specific environment variables e.g. YOUTUBE_CH_TECH_CLIENT_ID
      const sanitizedKey = channelId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const envClientId = process.env[`YOUTUBE_${sanitizedKey}_CLIENT_ID`];
      const envClientSecret = process.env[`YOUTUBE_${sanitizedKey}_CLIENT_SECRET`];
      const envRefreshToken = process.env[`YOUTUBE_${sanitizedKey}_REFRESH_TOKEN`];

      if (envClientId && envClientSecret && envRefreshToken) {
        console.log(`[YouTubePublisher] Loaded credentials for channel "${channelId}" from ENV.`);
        return new YouTubePublisher(
          {
            clientId: envClientId,
            clientSecret: envClientSecret,
            refreshToken: envRefreshToken,
          },
          channelId
        );
      }
    } catch (err: any) {
      console.warn(`[YouTubePublisher] Could not query channel credentials for ${channelId}: ${err.message}`);
    }

    // 3. Fallback to default legacy config
    console.log(`[YouTubePublisher] Using default/legacy YouTube credentials for channel "${channelId || 'default'}".`);
    return new YouTubePublisher({}, channelId);
  }

  /**
   * Factory method for ad-hoc credentials passed directly in API payload
   */
  public static forCredentials(creds: ChannelCredentialsInput, channelId?: string): YouTubePublisher {
    return new YouTubePublisher(creds, channelId);
  }

  isConfigured(): boolean {
    return Boolean(
      this.clientId &&
      this.clientSecret &&
      this.refreshToken &&
      this.refreshToken.trim() !== ''
    );
  }

  private async getFreshAccessToken(): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const data = await res.json();
    if (!res.ok || !data.access_token) {
      throw new Error(`[YouTubePublisher] Failed to refresh access token: ${JSON.stringify(data)}`);
    }

    // Cache updated token in DB if channelId is known
    if (this.channelId) {
      pool.query(
        'UPDATE channel_credentials SET access_token = $1, access_token_expires_at = NOW() + INTERVAL \'3500 seconds\', updated_at = NOW() WHERE channel_id = $2',
        [data.access_token, this.channelId]
      ).catch(() => {});
    }

    return data.access_token;
  }

  async uploadShort(videoSource: string, meta: YouTubeUploadMetadata): Promise<YouTubeUploadResult> {
    if (!this.isConfigured()) {
      throw new Error('[YouTubePublisher] YouTube credentials (client_id, client_secret, refresh_token) not configured.');
    }

    let localVideoPath = videoSource;
    let isTempDownload = false;

    // If videoSource is a remote URL (e.g. Cloudinary CDN), download to a temporary buffer/file first
    if (videoSource.startsWith('http://') || videoSource.startsWith('https://')) {
      console.log(`[YouTubePublisher] Downloading remote video from ${videoSource} for YouTube upload...`);
      const tempPath = path.join(config.storage.renders, `temp_remote_${Date.now()}.mp4`);
      const response = await fetch(videoSource);
      if (!response.ok) {
        throw new Error(`[YouTubePublisher] Failed to fetch remote video from ${videoSource}: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
      localVideoPath = tempPath;
      isTempDownload = true;
    }

    if (!fs.existsSync(localVideoPath)) {
      throw new Error(`[YouTubePublisher] Video file does not exist: ${localVideoPath}`);
    }

    const stat = fs.statSync(localVideoPath);
    const fileSize = stat.size;

    console.log(`[YouTubePublisher] Refreshing YouTube access token for channel "${this.channelId || 'default'}"...`);
    const accessToken = await this.getFreshAccessToken();

    // Ensure title includes #Shorts for YouTube algorithm detection
    let finalTitle = meta.title;
    if (!finalTitle.toLowerCase().includes('#shorts')) {
      finalTitle = `${finalTitle.slice(0, 90)} #Shorts`;
    }

    const channelTag = meta.channelName ? meta.channelName.replace(/\s+/g, '') : 'ShortsFactory';
    const defaultTags = ['Shorts', channelTag, meta.category];
    const finalTags = Array.from(new Set([...defaultTags, ...(meta.tags || [])]));

    const metadataPayload = {
      snippet: {
        title: finalTitle,
        description: `${meta.description}\n\n#Shorts #${channelTag} #${meta.category}`,
        tags: finalTags,
        categoryId: '27', // Education / Entertainment
      },
      status: {
        privacyStatus: meta.privacyStatus || config.youtube.defaultPrivacy || 'unlisted',
        selfDeclaredMadeForKids: false,
      },
    };

    console.log(`[YouTubePublisher] Initiating resumable upload session for "${finalTitle}"...`);
    const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(fileSize),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadataPayload),
    });

    if (!initRes.ok) {
      const err = await initRes.text();
      if (isTempDownload) fs.unlinkSync(localVideoPath);
      throw new Error(`[YouTubePublisher] Failed to initiate upload session: ${err}`);
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      if (isTempDownload) fs.unlinkSync(localVideoPath);
      throw new Error('[YouTubePublisher] Did not receive resumable upload location URL from Google.');
    }

    console.log(`[YouTubePublisher] Uploading ${(fileSize / 1024 / 1024).toFixed(2)}MB video binary to YouTube...`);
    const videoStream = fs.readFileSync(localVideoPath);

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(fileSize),
      },
      body: videoStream,
    });

    // Clean up temporary download file if used
    if (isTempDownload) {
      try {
        fs.unlinkSync(localVideoPath);
      } catch {}
    }

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData.id) {
      throw new Error(`[YouTubePublisher] Video upload failed: ${JSON.stringify(uploadData)}`);
    }

    const videoId = uploadData.id;
    const youtubeUrl = `https://youtube.com/shorts/${videoId}`;

    console.log(`[YouTubePublisher] Successfully published video! ID: ${videoId} -> ${youtubeUrl}`);

    return {
      videoId,
      youtubeUrl,
      title: finalTitle,
      privacyStatus: metadataPayload.status.privacyStatus,
    };
  }

  /**
   * Set a YouTube video's privacy status to public (used after human approval)
   */
  async setVideoPublic(youtubeVideoId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('[YouTubePublisher] YouTube credentials not configured.');
    }

    console.log(`[YouTubePublisher] Setting video ${youtubeVideoId} to PUBLIC...`);
    const accessToken = await this.getFreshAccessToken();

    // First get current video metadata
    const getRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${youtubeVideoId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const getData = await getRes.json();
    if (!getRes.ok || !getData.items?.length) {
      throw new Error(`[YouTubePublisher] Failed to get video info: ${JSON.stringify(getData)}`);
    }

    // Update privacy to public
    const updateRes = await fetch(
      'https://www.googleapis.com/youtube/v3/videos?part=status',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: youtubeVideoId,
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
          },
        }),
      }
    );

    if (!updateRes.ok) {
      const err = await updateRes.text();
      throw new Error(`[YouTubePublisher] Failed to set video public: ${err}`);
    }

    console.log(`[YouTubePublisher] ✅ Video ${youtubeVideoId} is now PUBLIC!`);
  }
}
