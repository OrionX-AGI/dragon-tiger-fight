/*
 * 从母版图标生成各平台上传页需要的方形尺寸。
 *
 * 母版是 docs/icon/icon-1024.png（1:1，龙虎对峙）。各平台对图标尺寸要求不一，
 * 但都要 1:1，所以统一从母版按需缩放，避免各处手工裁剪导致比例跑偏。
 *
 * 另外输出一张 icon-preview-masked.png：按常见的圆角遮罩（半径 22%）裁一版，
 * 用来确认平台加圆角后四角的云纹会不会被切掉。
 *
 * 用法：node scripts/make-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DIR = 'docs/icon';
const MASTER = path.join(DIR, 'icon-1024.png');

/** 各平台常见尺寸：512 是小红书等小程序/小工具上传页最常见的要求 */
const SIZES = [512, 256, 192, 128, 64];

async function main() {
  await mkdir(DIR, { recursive: true });

  const master = sharp(MASTER);
  const meta = await master.metadata();
  if (meta.width !== meta.height) {
    throw new Error(`母版不是 1:1：${meta.width}x${meta.height}`);
  }
  console.log(`母版 ${meta.width}x${meta.height}`);

  for (const size of SIZES) {
    const out = path.join(DIR, `icon-${size}.png`);
    await sharp(MASTER).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
    console.log(`  ${out}`);
  }

  // 网页端用的 webp（体积更小，供 README / 网页 favicon 之类场景）
  const webp = path.join(DIR, 'icon-512.webp');
  await sharp(MASTER).resize(512, 512).webp({ quality: 90 }).toFile(webp);
  console.log(`  ${webp}`);

  // 圆角遮罩预览：确认平台加圆角后四角云纹的裁切情况
  const size = 512;
  const radius = Math.round(size * 0.22);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  );
  const preview = path.join(DIR, 'icon-preview-masked.png');
  const body = await sharp(MASTER).resize(size, size).toBuffer();
  await sharp(body)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toFile(preview);
  console.log(`  ${preview}（圆角 ${radius}px 预览）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
