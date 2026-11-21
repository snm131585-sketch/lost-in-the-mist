// 单文件构建：esbuild 打包 TypeScript，并把 JS / CSS 内联进 dist/index.html
// 用法：node scripts/build.mjs [--dev]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); }
catch { esbuild = require(process.env.ESBUILD_PATH || '/opt/npm-tools/node_modules/esbuild'); }

const dev = process.argv.includes('--dev');
const result = await esbuild.build({
  entryPoints: [resolve(root, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
const js = result.outputFiles[0].text;
const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
let html = readFileSync(resolve(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="\.\/src\/styles\.css" \/>/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module" src="\.\/src\/main\.ts"><\/script>/, () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/index.html'), html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(1)} KB  (${dev ? 'dev' : 'minified'})`);
