// 将 public/assets 下的原始 PNG 压缩为 WebP：牌面宽 640，底纹宽 1024
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(process.cwd(), 'public/assets');

async function compressDir(dir, width) {
  const files = await readdir(dir);
  for (const file of files) {
    if (!file.endsWith('.png')) continue;
    const src = path.join(dir, file);
    const dest = path.join(dir, file.replace(/\.png$/, '.webp'));
    await sharp(src).resize({ width }).webp({ quality: 82 }).toFile(dest);
    await unlink(src);
    console.log(`${file} -> ${path.basename(dest)}`);
  }
}

await compressDir(path.join(root, 'cards'), 640);
await compressDir(root, 1024);
console.log('done');
