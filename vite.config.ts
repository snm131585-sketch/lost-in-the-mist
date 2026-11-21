// Vite 配置：本地有网络时使用 `npm install && npm run dev`
// （本仓库在无网络环境下用 scripts/build.mjs + esbuild 构建单文件版本）
export default {
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    target: 'es2020',
  },
  server: { host: true, port: 5173 },
};
