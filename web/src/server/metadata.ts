import { ExifTool } from 'exiftool-vendored';
import type { Logger } from 'batch-cluster';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { CanonicalPayload } from '@identik/crypto-utils';

const IDENTIK_EXIF_TAG = 'XMP-dc:Description';
const SIGN_DEBUG_ENABLED = process.env.SIGN_DEBUG === 'true';
const parsePositiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const EXIF_TOOL_TASK_TIMEOUT_MS = parsePositiveNumber(process.env.EXIFTOOL_TASK_TIMEOUT_MS, 20_000);
const EXIF_TOOL_IDLE_INTERVAL_MS = parsePositiveNumber(process.env.EXIFTOOL_IDLE_INTERVAL_MS, 1_000);

const logMetadataDebug = (...args: unknown[]) => {
  if (SIGN_DEBUG_ENABLED) {
    console.info('[metadata]', ...args);
  }
};

const createDebugLogger = (): Logger => {
  const log =
    (level: keyof Logger): Logger['info'] =>
    (message: string, ...rest: unknown[]) => {
      const prefix = `[metadata/exiftool][${level}]`;
      if (level === 'warn') {
        console.warn(prefix, message, ...rest);
      } else if (level === 'error') {
        console.error(prefix, message, ...rest);
      } else {
        console.info(prefix, message, ...rest);
      }
    };

  return {
    trace: log('trace'),
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error')
  };
};

const createDebugLoggerFactory = (): (() => Logger) => {
  const logger = createDebugLogger();
  return () => logger;
};

let lastDebuggedExifTool: ExifTool | undefined;
const attachExifToolDebugListeners = (tool: ExifTool) => {
  if (!SIGN_DEBUG_ENABLED || lastDebuggedExifTool === tool) {
    return;
  }
  lastDebuggedExifTool = tool;
  const emit = (event: string, payload?: Record<string, unknown>) => {
    logMetadataDebug(`exiftool_${event}`, payload ?? {});
  };

  tool.on('childStart', (proc) => emit('child_start', { pid: proc.pid }));
  tool.on('childEnd', (proc, reason) =>
    emit('child_end', { pid: proc?.pid, reason })
  );
  tool.on('taskResolved', (task, proc) =>
    emit('task_resolved', {
      pid: proc?.pid,
      command: task?.command,
      runtimeMs: task?.runtimeMs
    })
  );
  tool.on('taskTimeout', (timeoutMs, task, proc) =>
    emit('task_timeout', {
      timeoutMs,
      pid: proc?.pid,
      command: task?.command
    })
  );
  tool.on('taskError', (error, task, proc) =>
    emit('task_error', {
      pid: proc?.pid,
      command: task?.command,
      message: error?.message
    })
  );
  tool.on('healthCheckError', (error, proc) =>
    emit('health_check_error', {
      pid: proc?.pid,
      message: error?.message
    })
  );
  tool.on('startError', (error) => emit('start_error', { message: error?.message }));
  tool.on('fatalError', (error) => emit('fatal_error', { message: error?.message }));
  tool.on('internalError', (error) => emit('internal_error', { message: error?.message }));
};

const logExifToolState = (event: string, tool: ExifTool, extra?: Record<string, unknown>) => {
  if (!SIGN_DEBUG_ENABLED) return;
  logMetadataDebug(`exiftool_${event}`, {
    pendingTasks: tool.pendingTasks,
    busyProcs: tool.busyProcs,
    spawnedProcs: tool.spawnedProcs,
    pids: tool.pids,
    ...extra
  });
};

const globalRef = globalThis as typeof globalThis & {
  __identikExifTool__?: ExifTool;
};

const getExifTool = () => {
  if (!globalRef.__identikExifTool__ || globalRef.__identikExifTool__.ended) {
    logMetadataDebug('creating exiftool instance', {
      taskTimeoutMs: EXIF_TOOL_TASK_TIMEOUT_MS,
      idleIntervalMs: EXIF_TOOL_IDLE_INTERVAL_MS
    });
    globalRef.__identikExifTool__ = new ExifTool({
      maxProcs: 1,
      taskTimeoutMillis: EXIF_TOOL_TASK_TIMEOUT_MS,
      onIdleIntervalMillis: EXIF_TOOL_IDLE_INTERVAL_MS,
      endGracefulWaitTimeMillis: 500,
      logger: SIGN_DEBUG_ENABLED ? createDebugLoggerFactory() : undefined
    });
    attachExifToolDebugListeners(globalRef.__identikExifTool__);
  } else {
    attachExifToolDebugListeners(globalRef.__identikExifTool__);
  }
  return globalRef.__identikExifTool__;
};

const isBatchClusterEndedError = (error: unknown): error is Error => {
  return error instanceof Error && error.message.includes('BatchCluster has ended');
};

const withExifTool = async <T>(handler: (tool: ExifTool) => Promise<T>, retry = true): Promise<T> => {
  const tool = getExifTool();
  try {
    return await handler(tool);
  } catch (error) {
    if (retry && isBatchClusterEndedError(error)) {
      logMetadataDebug('ExifTool batch cluster ended, recreating instance');
      await tool.end().catch(() => undefined);
      if (globalRef.__identikExifTool__ === tool) {
        globalRef.__identikExifTool__ = undefined;
      }
      logMetadataDebug('ExifTool instance cleared, retrying task');
      return withExifTool(handler, false);
    }
    throw error;
  }
};

export interface IdentikStamp {
  version: number;
  identik_name: string;
  payload_sha256: string;
  key_fingerprint: string;
  signature: string;
  signed_at: string;
}

export interface IdentikEmbeddedMetadata {
  identik_stamp: IdentikStamp;
  canonical_payload: CanonicalPayload;
}

const writeTempFile = async (buffer: Buffer) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'identik-'));
  const filePath = path.join(dir, `${randomUUID()}`);
  await fs.writeFile(filePath, buffer);
  return { dir, filePath };
};

const cleanupTempDir = async (dir: string) => {
  await fs.rm(dir, { recursive: true, force: true });
};

export const embedIdentikMetadata = async (
  buffer: Buffer,
  payload: IdentikEmbeddedMetadata
): Promise<Buffer> => {
  const { dir, filePath } = await writeTempFile(buffer);
  const tempFileLabel = path.basename(filePath);
  try {
    logMetadataDebug('embed_temp_file_ready', {
      tempFile: tempFileLabel,
      bufferBytes: buffer.byteLength
    });
    await withExifTool(async (tool) => {
      logExifToolState('write_start', tool, { tempFile: tempFileLabel });
      const writeStart = Date.now();
      const tags = {
        [IDENTIK_EXIF_TAG]: JSON.stringify(payload)
      } satisfies Record<string, string>;
      await tool.write(filePath, tags as unknown as Record<string, string>, ['-overwrite_original']);
      logExifToolState('write_finish', tool, {
        tempFile: tempFileLabel,
        durationMs: Date.now() - writeStart
      });
    });
    const result = await fs.readFile(filePath);
    logMetadataDebug('embed_temp_file_read', { tempFile: tempFileLabel, bytes: result.length });
    return result;
  } finally {
    await cleanupTempDir(dir);
  }
};

export const extractIdentikMetadata = async (buffer: Buffer): Promise<IdentikEmbeddedMetadata | null> => {
  const { dir, filePath } = await writeTempFile(buffer);
  try {
    const metadata = await withExifTool((tool) => tool.read(filePath));
    const rawValue = (metadata as Record<string, unknown>)[IDENTIK_EXIF_TAG] ?? metadata.Description;
    if (!rawValue) return null;

    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (typeof value !== 'string') return null;

    const parsed = JSON.parse(value) as IdentikEmbeddedMetadata;
    if (!parsed?.identik_stamp || !parsed?.canonical_payload) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  } finally {
    await cleanupTempDir(dir);
  }
};

export const normalizeBufferForVerification = async (buffer: Buffer): Promise<Buffer> => {
  const { dir, filePath } = await writeTempFile(buffer);
  const tempFileLabel = path.basename(filePath);
  try {
    logMetadataDebug('normalize_temp_file_ready', {
      tempFile: tempFileLabel,
      bufferBytes: buffer.byteLength
    });
    await withExifTool(async (tool) => {
      logExifToolState('normalize_start', tool, { tempFile: tempFileLabel });
      const normalizeStart = Date.now();
      await tool.write(filePath, {}, ['-overwrite_original', `-${IDENTIK_EXIF_TAG}=`, '-m']);
      logExifToolState('normalize_finish', tool, {
        tempFile: tempFileLabel,
        durationMs: Date.now() - normalizeStart
      });
    });
    const result = await fs.readFile(filePath);
    logMetadataDebug('normalize_temp_file_read', { tempFile: tempFileLabel, bytes: result.length });
    return result;
  } catch (error) {
    logMetadataDebug('normalize_failed', {
      tempFile: tempFileLabel,
      message: error instanceof Error ? error.message : String(error)
    });
    return buffer;
  } finally {
    await cleanupTempDir(dir);
  }
};
