/// <reference types="vite/client" />

/** 构建期把 Markdown 渲染成 HTML 字符串（见 vite.config.ts 的 markdownAsHtml 插件） */
declare module '*.md?html' {
  const html: string;
  export default html;
}
