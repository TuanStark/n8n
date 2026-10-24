export interface CloudinaryUploadOptions {
  channelId: string;
  jobId: string;
  tags?: string[];
  publicId?: string;
}

export interface CloudinaryAssetResult {
  publicId: string;
  secureUrl: string;
  bytes: number;
  format: string;
  durationSec: number;
}

export interface IStorageService {
  /**
   * Check whether Cloudinary CDN credentials are fully valid
   */
  isConfigured(): boolean;

  /**
   * Creates an isolated ephemeral scratchpad directory for this job
   * (e.g. /tmp/shorts_scratchpad/{jobId})
   */
  createScratchpad(jobId: string): Promise<string>;

  /**
   * Uploads final rendered video to Cloudinary under namespaced channel folder
   */
  uploadVideoToCloudinary(
    localFilePath: string,
    options: CloudinaryUploadOptions
  ): Promise<CloudinaryAssetResult>;

  /**
   * Guaranteed deterministic purge of the entire ephemeral scratchpad directory
   * Ensures local disk footprint is 0 bytes after job finishes
   */
  purgeScratchpad(scratchpadDir: string): Promise<boolean>;

  /**
   * Purges single ephemeral file
   */
  purgeLocalFile(filePath: string): boolean;
}
