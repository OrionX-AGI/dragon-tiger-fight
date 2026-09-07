import { readFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { marked } from 'marked';
import { defineConfig } from 'vitest/config';

/**
 * 把 `import html from './x.md?html'` 在构建期渲染成 HTML 字符串。
 *
 * 原先运行时用 react-markdown + remark-gfm 渲染规则页，但这条依赖链在顶层用
 * RegExp() 构造了 `\p{ID_Start}` 与 lookbehind 正则，Chrome 61 构造时直接抛
 * SyntaxError 导致整包初始化失败；Object.hasOwn 同样不可用。规则文档是随包
 * 固定的静态内容，放到构建期渲染既绕开兼容问题，也省掉运行时的解析开销。
 */
function markdownAsHtml() {
  return {
    name: 'markdown-as-html',
    async load(id: string) {
      const [file, query] = id.split('?');
      if (query !== 'html' || !file.endsWith('.md')) return null;
      const text = await readFile(file, 'utf8');
      const html = await marked.parse(text, { gfm: true, async: false });
      return `export default ${JSON.stringify(html)};`;
    },
  };
}

/**
 * 小红书小工具容器要求入口脚本是「经典脚本」：不能带 type="module"。
 * Vite 生成的 index.html 固定写成 <script type="module" crossorigin src> 且放在 <head>，
 * 这里把它改写成普通 <script src> 并移到 </body> 前。
 *
 * 移动位置是必须的：module 脚本默认 defer，改成经典脚本后会立即执行，
 * 留在 <head> 里会在 <div id="root"> 挂载前跑，React 找不到根节点直接白屏。
 */
function classicScriptTag() {
  return {
    name: 'xhs-classic-script',
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      const srcs: string[] = [];
      let out = html.replace(
        /[ \t]*<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>\r?\n?/g,
        (_full, src: string) => {
          srcs.push(src);
          return '';
        },
      );
      // crossorigin 会让同源样式表也走 CORS 模式，离线容器的自定义 scheme 下可能直接加载失败
      out = out.replace(/(<link\b[^>]*)\s+crossorigin(=("[^"]*"|'[^']*'))?/g, '$1');
      const tags = srcs.map((src) => `    <script src="${src}"></script>`).join('\n');
      return out.replace('</body>', `${tags}\n  </body>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), markdownAsHtml(), classicScriptTag()],
  // 离线 zip 以包根为 /，资源必须相对引用
  base: './',
  build: {
    // 最低兼容 Android 8.1 出场的 Chrome / WebView 61
    target: ['es2017', 'chrome61'],
    sourcemap: false,
    // 单入口应用，不需要按路由拆分 CSS
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // IIFE 单文件产物：容器不支持 ES module，也不能靠目录服务解析相对 import
        format: 'iife',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    // 必须显式绑定 IPv4 回环地址：默认的 'localhost' 在本机会被 Node 解析为 ::1，
    // 导致只监听 IPv6，而浏览器访问 localhost 走 127.0.0.1，连不上。
    host: '127.0.0.1',
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
