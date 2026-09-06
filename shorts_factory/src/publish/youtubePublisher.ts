import fs from 'fs';
import { config } from '../config';

export interface YouTubeUploadMetadata {
  title: string;
  description: string;
  category: string;
  tags?: string[];
  privacyStatus?: 'private' | 'unlisted' | 'public';
}

export interface YouTubeUploadResult {
  videoId: string;
  youtubeUrl: string;
  title: string;
  privacyStatus: string;
}

export class YouTubePublisher {
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;

  constructor() {
    this.clientId = config.youtube.clientId;
    this.clientSecret = config.youtube.clientSecret;
    this.refreshToken = config.youtube.refreshToken;
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

    return data.access_token;
  }

  async uploadShort(videoPath: string, meta: YouTubeUploadMetadata): Promise<YouTubeUploadResult> {
    if (!this.isConfigured()) {
      throw new Error('[YouTubePublisher] YouTube credentials (client_id, client_secret, refresh_token) not configured.');
    }

    if (!fs.existsSync(videoPath)) {
      throw new Error(`[YouTubePublisher] Video file does not exist: ${videoPath}`);
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;

    console.log(`[YouTubePublisher] Refreshing YouTube access token...`);
    const accessToken = await this.getFreshAccessToken();

    // Ensure title includes #Shorts for YouTube algorithm detection
    let finalTitle = meta.title;
    if (!finalTitle.toLowerCase().includes('#shorts')) {
      finalTitle = `${finalTitle.slice(0, 90)} #Shorts`;
    }

    const defaultTags = ['Shorts', 'history', 'papertheater', 'ancienthistory', meta.category];
    const finalTags = Array.from(new Set([...defaultTags, ...(meta.tags || [])]));

    const metadataPayload = {
      snippet: {
        title: finalTitle,
        description: `${meta.description}\n\n#Shorts #History #PaperTheaterWorld #${meta.category}`,
        tags: finalTags,
        categoryId: '27', // Education
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
      throw new Error(`[YouTubePublisher] Failed to initiate upload session: ${err}`);
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      throw new Error('[YouTubePublisher] Did not receive resumable upload location URL from Google.');
    }

    console.log(`[YouTubePublisher] Uploading ${ (fileSize / 1024 / 1024).toFixed(2) }MB video binary...`);
    const videoStream = fs.readFileSync(videoPath);

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(fileSize),
      },
      body: videoStream,
    });

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
}
