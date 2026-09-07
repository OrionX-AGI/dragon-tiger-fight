/*
 * 极小的 ZIP 写入器（deflate + 中央目录），用于生成小工具产物包。
 *
 * 自己实现而不是引第三方库，是为了完全控制包结构：条目路径一律用 `/` 分隔且
 * 不带任何顶层目录，保证解压后 index.html 直接位于 zip 根目录——这是容器能否
 * 加载小工具的硬性前提。
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 把时间转成 DOS 日期/时间字段 */
function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export default class ZipWriter {
  constructor() {
    this.entries = [];
    this.stamp = dosDateTime(new Date());
  }

  /** name 必须是以 `/` 分隔的包内相对路径，不能以 `/` 或 `./` 开头 */
  add(name, data) {
    const clean = name.replace(/^\.?\//, '');
    this.entries.push({ name: clean, data });
  }

  toBuffer() {
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
      const deflated = deflateRawSync(raw, { level: 9 });
      // 压不小就原样存储（method 0），避免图片这类已压缩数据反而变大
      const useDeflate = deflated.length < raw.length;
      const body = useDeflate ? deflated : raw;
      const method = useDeflate ? 8 : 0;
      const crc = crc32(raw);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0x0800, 6); // 文件名按 UTF-8 解释
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(this.stamp.time, 10);
      local.writeUInt16LE(this.stamp.day, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28); // extra length

      chunks.push(local, nameBuf, body);

      const dir = Buffer.alloc(46);
      dir.writeUInt32LE(0x02014b50, 0);
      dir.writeUInt16LE(20, 4); // version made by
      dir.writeUInt16LE(20, 6); // version needed
      dir.writeUInt16LE(0x0800, 8);
      dir.writeUInt16LE(method, 10);
      dir.writeUInt16LE(this.stamp.time, 12);
      dir.writeUInt16LE(this.stamp.day, 14);
      dir.writeUInt32LE(crc, 16);
      dir.writeUInt32LE(body.length, 20);
      dir.writeUInt32LE(raw.length, 24);
      dir.writeUInt16LE(nameBuf.length, 28);
      dir.writeUInt16LE(0, 30); // extra
      dir.writeUInt16LE(0, 32); // comment
      dir.writeUInt16LE(0, 34); // disk number
      dir.writeUInt16LE(0, 36); // internal attrs
      // external attrs：普通文件 644。JS 位运算是 32 位有符号的，左移后要转回无符号
      dir.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      dir.writeUInt32LE(offset, 42);
      central.push(dir, nameBuf);

      offset += local.length + nameBuf.length + body.length;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); // disk
    end.writeUInt16LE(0, 6); // disk with central dir
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...chunks, centralBuf, end]);
  }
}
