import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 头像上传约束（常规限制）：
 * - 仅接受位图格式 jpeg / png / webp / gif，拒绝 SVG（可嵌入脚本，防 XSS）
 * - 按文件魔数（而非仅依赖 Content-Type）识别真实格式，防伪造扩展名
 * - 单文件 ≤ 2MB
 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export type AvatarImageType = 'jpeg' | 'png' | 'webp' | 'gif';

const MIME_BY_TYPE: Record<AvatarImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** 按魔数识别图片类型；无法识别返回 null（非允许的位图格式） */
export function detectImageType(buffer: Uint8Array): AvatarImageType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'gif';
  }
  // RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

export function mimeFor(type: AvatarImageType): string {
  return MIME_BY_TYPE[type];
}

/**
 * 头像文件存储：按用户 id 落盘为 `<userId>.<ext>`（重复上传覆盖旧文件并清理旧扩展名残留）。
 * 目录由调用方（main.ts）依据 DB 目录创建并传入。
 */
export class AvatarStore {
  constructor(private readonly dir: string) {}

  /** 保存头像；返回该用户当前落盘文件的相对文件名（不含目录） */
  public save(userId: string, buffer: Uint8Array): string {
    mkdirSync(this.dir, { recursive: true });
    const type = detectImageType(buffer);
    if (type === null) throw new AvatarError('仅支持 jpg / png / webp / gif 格式的图片');
    const fileName = `${userId}.${type}`;
    // 覆盖旧文件：清理同用户其它扩展名（png→jpeg 等格式切换时避免残留）
    for (const existing of readdirSync(this.dir)) {
      if (existing.startsWith(`${userId}.`)) rmSync(join(this.dir, existing));
    }
    writeFileSync(join(this.dir, fileName), buffer);
    return fileName;
  }

  /** 读取用户头像；无则返回 null。返回字节与对应 MIME */
  public read(userId: string): { buffer: Uint8Array<ArrayBuffer>; mime: string } | null {
    if (!existsSync(this.dir)) return null;
    for (const entry of readdirSync(this.dir)) {
      if (!entry.startsWith(`${userId}.`)) continue;
      const dot = entry.lastIndexOf('.');
      if (dot < 0) continue;
      const ext = entry.slice(dot + 1) as AvatarImageType;
      const mime = MIME_BY_TYPE[ext];
      if (mime === undefined) continue;
      // 复制为 Uint8Array<ArrayBuffer>：readFileSync 返回 Buffer（ArrayBufferLike），Hono body 需 ArrayBuffer
      return { buffer: new Uint8Array(readFileSync(join(this.dir, entry))), mime };
    }
    return null;
  }
}

export class AvatarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarError';
  }
}
