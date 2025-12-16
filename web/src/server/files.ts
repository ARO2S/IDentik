import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { spawn } from 'node:child_process';

export const fileToBuffer = async (file: File): Promise<Buffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const sha256StreamHex = async (file: File): Promise<string> => {
  // Streaming hash prevents loading very large files entirely into memory.
  const hash = createHash('sha256');
  // Cast the web stream to the node-compatible type so TypeScript knows it
  // supports async iteration as expected by Readable.fromWeb.
  const readable = Readable.fromWeb(file.stream() as unknown as NodeReadableStream);
  for await (const chunk of readable) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
};

export const probeVideoDurationSeconds = async (file: File): Promise<number | null> => {
  // Stream the file into ffprobe to avoid buffering large videos in memory.
  return new Promise<number | null>((resolve) => {
    const ff = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      '-'
    ]);

    // Discard stderr output to avoid backpressure if ffprobe logs warnings.
    ff.stderr.resume();

    let stdout = '';

    ff.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ff.on('close', () => {
      const duration = Number(stdout.trim());
      resolve(Number.isFinite(duration) ? duration : null);
    });
    ff.on('error', () => resolve(null));

    // Pipe the file stream into ffprobe stdin.
    const readable = Readable.fromWeb(file.stream() as unknown as NodeReadableStream);
    readable.pipe(ff.stdin);
  });
};

export const getSafeFileName = (file: File | null, fallbackExt = 'jpg'): string => {
  const name = file?.name?.trim();
  if (name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
  return `photo-${Date.now()}.${fallbackExt}`;
};

export const appendSuffixToFileName = (fileName: string, suffix: string): string => {
  if (!suffix) {
    return fileName;
  }

  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return `${fileName}${suffix}`;
  }

  const baseName = fileName.slice(0, lastDotIndex);
  const extension = fileName.slice(lastDotIndex);
  return `${baseName}${suffix}${extension}`;
};
