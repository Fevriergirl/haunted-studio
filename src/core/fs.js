import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
}

export async function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}
