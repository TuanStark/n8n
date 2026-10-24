export type VideoJobStatus =
  | 'QUEUED'
  | 'SCRIPTING'
  | 'ASSET_GENERATING'
  | 'RENDERING'
  | 'QC_VALIDATION'
  | 'CLOUDINARY_UPLOADING'
  | 'YOUTUBE_PUBLISHING'
  | 'COMPLETED'
  | 'FAILED';

export interface VideoJobProgress {
  stage: VideoJobStatus;
  percentage: number;
  message: string;
  updatedAt: Date;
}

export interface VideoJobResult {
  jobId: string;
  channelId: string;
  channelName: string;
  genreKey: string;
  title: string;
  durationSec: number;
  fileSizeBytes: number;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  youtubeVideoId?: string;
  youtubeUrl?: string;
  purgedLocalDisk: boolean;
  qcStatus: 'PASS' | 'WARNING' | 'FAIL';
  createdAt: Date;
}
