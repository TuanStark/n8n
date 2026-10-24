import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IStorageService, CloudinaryUploadOptions, CloudinaryAssetResult } from '../../core/ports/IStorageService';
import { config } from '../../config';

export class CloudinaryStorageService implements IStorageService {
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;
  private scratchpadBaseDir: string;

  constructor() {
    this.cloudName = config.cloudinary.cloudName;
    this.apiKey = config.cloudinary.apiKey;
    this.apiSecret = config.cloudinary.apiSecret;

    // Parse cloudinary:// URL if provided in environment
    if (config.cloudinary.url && config.cloudinary.url.startsWith('cloudinary://')) {
      const match = config.cloudinary.url.match(/cloudinary:\/\/([^:]+):([^@]+)@(.+)/);
      if (match) {
        this.apiKey = match[1];
        this.apiSecret = match[2];
        this.cloudName = match[3];
      }
    }

    // Default scratchpad directory in /tmp (ephemeral ramdisk / fast storage)
    this.scratchpadBaseDir = path.join('/tmp', 'shorts_scratchpad');
    if (!fs.existsSync(this.scratchpadBaseDir)) {
      fs.mkdirSync(this.scratchpadBaseDir, { recursive: true });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.cloudName && this.apiKey && this.apiSecret);
  }

  async createScratchpad(jobId: string): Promise<string> {
    const dir = path.join(this.scratchpadBaseDir, jobId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  async uploadVideoToCloudinary(
    localFilePath: string,
    options: CloudinaryUploadOptions
  ): Promise<CloudinaryAssetResult> {
    if (!this.isConfigured()) {
      throw new Error(
        '[CloudinaryStorage] Cloudinary is not configured. Please supply CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env'
      );
    }

    if (!fs.existsSync(localFilePath)) {
      throw new Error(`[CloudinaryStorage] File does not exist for upload: ${localFilePath}`);
    }

    const stat = fs.statSync(localFilePath);
    const fileSizeMB = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`[CloudinaryStorage] ☁️ Uploading ${fileSizeMB} MB video to Cloudinary (${this.cloudName})...`);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = `shorts_factory/${options.channelId}`;
    const publicId = options.publicId || `${options.channelId}_${options.jobId}`;
    const tags = (options.tags || ['shorts_factory', options.channelId]).join(',');

    // Build signature
    const paramsToSign: Record<string, string> = {
      folder,
      public_id: publicId,
      tags,
      timestamp,
    };

    const sortedKeys = Object.keys(paramsToSign).sort();
    const signatureBase = sortedKeys.map((k) => `${k}=${paramsToSign[k]}`).join('&') + this.apiSecret;
    const signature = crypto.createHash('sha1').update(signatureBase).digest('hex');

    // Create payload
    const blob = await fs.openAsBlob(localFilePath);
    const form = new FormData();
    form.append('file', blob, path.basename(localFilePath));
    form.append('api_key', this.apiKey);
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('folder', folder);
    form.append('public_id', publicId);
    form.append('tags', tags);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${this.cloudName}/video/upload`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      body: form,
    });

    const data: any = await res.json();
    if (!res.ok || !data.secure_url) {
      throw new Error(`[CloudinaryStorage] Upload failed: ${JSON.stringify(data)}`);
    }

    console.log(`[CloudinaryStorage] ✅ Upload succeeded! CDN URL: ${data.secure_url}`);
    return {
      publicId: data.public_id,
      secureUrl: data.secure_url,
      bytes: data.bytes || stat.size,
      format: data.format || 'mp4',
      durationSec: data.duration || 0,
    };
  }

  async purgeScratchpad(scratchpadDir: string): Promise<boolean> {
    try {
      if (fs.existsSync(scratchpadDir)) {
        fs.rmSync(scratchpadDir, { recursive: true, force: true });
        console.log(`[CloudinaryStorage] 🧹 Ephemeral scratchpad purged: ${scratchpadDir} (Disk usage = 0 MB)`);
        return true;
      }
    } catch (err: any) {
      console.warn(`[CloudinaryStorage] Warning: Failed to purge scratchpad ${scratchpadDir}: ${err.message}`);
    }
    return false;
  }

  purgeLocalFile(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    } catch (err: any) {
      console.warn(`[CloudinaryStorage] Warning: Failed to purge file ${filePath}: ${err.message}`);
    }
    return false;
  }
}
