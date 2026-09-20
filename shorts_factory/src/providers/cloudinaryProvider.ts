import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';

export interface CloudinaryUploadResult {
  publicId: string;
  secureUrl: string;
  durationSec: number;
  format: string;
  bytes: number;
}

export class CloudinaryProvider {
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(customConfig?: { cloudName?: string; apiKey?: string; apiSecret?: string; url?: string }) {
    let cloudName = customConfig?.cloudName || config.cloudinary.cloudName;
    let apiKey = customConfig?.apiKey || config.cloudinary.apiKey;
    let apiSecret = customConfig?.apiSecret || config.cloudinary.apiSecret;
    const url = customConfig?.url || config.cloudinary.url;

    // Support cloudinary://API_KEY:API_SECRET@CLOUD_NAME format
    if (url && url.startsWith('cloudinary://')) {
      const match = url.match(/cloudinary:\/\/([^:]+):([^@]+)@(.+)/);
      if (match) {
        apiKey = apiKey || match[1];
        apiSecret = apiSecret || match[2];
        cloudName = cloudName || match[3];
      }
    }

    this.cloudName = cloudName;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  isConfigured(): boolean {
    return Boolean(this.cloudName && this.apiKey && this.apiSecret);
  }

  /**
   * Upload video binary to Cloudinary CDN
   */
  async uploadVideo(
    filePath: string,
    options: {
      folder?: string;
      publicId?: string;
      tags?: string[];
    } = {}
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured()) {
      throw new Error(
        '[CloudinaryProvider] Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env'
      );
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`[CloudinaryProvider] Local video file does not exist: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    const fileSizeMB = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`[CloudinaryProvider] Uploading ${fileSizeMB} MB video to Cloudinary (${this.cloudName})...`);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = options.folder || 'shorts_factory';
    const tags = (options.tags || ['shorts_factory', 'ai_video']).join(',');

    // Build signed parameters in alphabetical order
    const paramsToSign: Record<string, string> = {
      folder,
      tags,
      timestamp,
    };

    if (options.publicId) {
      paramsToSign['public_id'] = options.publicId;
    }

    const sortedKeys = Object.keys(paramsToSign).sort();
    const signatureBase = sortedKeys.map((k) => `${k}=${paramsToSign[k]}`).join('&') + this.apiSecret;
    const signature = crypto.createHash('sha1').update(signatureBase).digest('hex');

    // Build form data
    const blob = await fs.openAsBlob(filePath);
    const form = new FormData();
    form.append('file', blob, path.basename(filePath));
    form.append('api_key', this.apiKey);
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('folder', folder);
    form.append('tags', tags);
    if (options.publicId) {
      form.append('public_id', options.publicId);
    }

    const uploadUrl = `https://api.cloudinary.com/v1_1/${this.cloudName}/video/upload`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      body: form,
    });

    const data = await res.json();
    if (!res.ok || !data.secure_url) {
      throw new Error(`[CloudinaryProvider] Upload failed: ${JSON.stringify(data)}`);
    }

    console.log(`[CloudinaryProvider] ✅ Upload complete! Public ID: ${data.public_id}`);
    console.log(`[CloudinaryProvider] 🌐 CDN URL: ${data.secure_url}`);

    return {
      publicId: data.public_id,
      secureUrl: data.secure_url,
      durationSec: data.duration || 0,
      format: data.format || 'mp4',
      bytes: data.bytes || stat.size,
    };
  }

  /**
   * Auto-Purge helper to clean local video file after upload to cloud
   */
  purgeLocalFile(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const freedMB = (stat.size / 1024 / 1024).toFixed(2);
        fs.unlinkSync(filePath);
        console.log(`[CloudinaryProvider] 🧹 Auto-purged local file: ${path.basename(filePath)} (Freed ${freedMB} MB)`);
        return true;
      }
    } catch (err: any) {
      console.warn(`[CloudinaryProvider] Could not purge local file ${filePath}: ${err.message}`);
    }
    return false;
  }

  /**
   * Purge temporary directory (e.g. temp_shortId containing raw frames)
   */
  purgeTempDirectory(dirPath: string): boolean {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`[CloudinaryProvider] 🧹 Cleaned temp render directory: ${dirPath}`);
        return true;
      }
    } catch (err: any) {
      console.warn(`[CloudinaryProvider] Could not purge temp dir ${dirPath}: ${err.message}`);
    }
    return false;
  }
}
