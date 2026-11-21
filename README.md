# Lost in the Mist · 迷雾拾荒者

一款 2D 俯视角幻想森林探索网页游戏。你在浓雾里醒来，要拾取材料、点亮灯笼驱散迷雾、制作月光符文，最后唤醒北方的森林祭坛。

- **在线试玩（私有页面，分享与否由你决定）**：https://claude.ai/artifact/MpehKVTfVBfTEVy8Y9jK6T
- 首次通关大约需要 15–25 分钟。支持桌面键盘和手机触屏，进度自动保存在浏览器里。

## 功能
主菜单（新游戏 / 继续 / 操作说明 / 设置）· 96×72 格的森林地图 · 角色行走动画（三个方向，各 6 帧）· 键盘和浮动虚拟摇杆 · 摄像机平滑跟随 · 瓦片碰撞 · 迷雾探索（带小地图和大地图）· 4 种资源 · 背包 · 4 种制作配方 · 6 个连续任务 · 森林祭坛与结局演出 · 暂停和设置（音量、触屏控件、特效档位）· 自动存档 · WebAudio 合成的音效和生成式环境音乐 · 5 块剧情石碑

详细玩法见 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)，美术规范见 [docs/ART_GUIDE.md](docs/ART_GUIDE.md)，测试结果见 [docs/TEST_REPORT.md](docs/TEST_REPORT.md)。

## 技术栈（以及和原定方案的差异）
| 原定 | 实际 | 原因 |
|---|---|---|
| Phaser | 自研轻量 Canvas 2D 引擎（`src/engine`、`src/game/game.ts`） | 开发环境的网络策略拒绝访问 npm 仓库（403），Phaser 装不上 |
| Vite | 开发环境里用 esbuild 构建（`scripts/build.mjs`）；`vite.config.ts` 和 `npm run dev` 也已配好 | 原因同上。Vite 配置没有在开发环境里实际运行过 |
| TypeScript / HTML / CSS / LocalStorage / Git | 都已使用 | — |

游戏逻辑（`src/game/data.ts` 和 `state.ts`：物品、配方、任务、存档）不依赖任何引擎，以后迁移到 Phaser 时可以直接复用。

## 本地运行
需要 Node.js 18 或更高版本。

**方式 A：标准 Vite 流程（需要能访问网络）**
```bash
npm install
npm run dev        # 打开 http://localhost:5173
npm run build      # 输出到 dist/
```

**方式 B：不安装依赖，构建单文件版本**（需要能找到 esbuild，可以全局安装，也可以设置 `ESBUILD_PATH`）
```bash
node scripts/build.mjs   # 生成 dist/index.html（约 107 KB，所有资源都内联在里面）
# 直接双击打开 dist/index.html 就能玩，不需要服务器
```

**端到端测试**（需要 Playwright 和 Chromium）
```bash
npm run test:e2e
```

## 部署
`dist/index.html` 是一个完全自包含的单文件，没有外部请求，可以直接放到任何静态托管服务上：
- **GitHub Pages**：把 `dist/index.html` 推送到 `gh-pages` 分支，或者在 Pages 设置里指定 `/dist` 目录。
- **Netlify / Vercel / Cloudflare Pages**：构建命令填 `node scripts/build.mjs`（或 `npm run build`），发布目录填 `dist`。
- **任何 Nginx 或对象存储**：把这一个文件上传上去就行。

当前在线版本发布在 Claude 的私有页面上。它默认只有你自己能看到，是否分享由你在页面上决定。

## 目录结构
```
index.html            页面结构（菜单、HUD、面板）
src/styles.css        UI 样式
src/main.ts           入口
src/engine/           math · input · audio
src/art/              painters（程序化美术）· manifest（资源表，可替换为正式 PNG）
src/world/            map（地图生成、碰撞）· ground（地面烘焙）· fog（迷雾）
src/game/             data · state · game（主循环和渲染）
src/ui/               ui（DOM 界面）
scripts/build.mjs     单文件构建
tests/e2e.mjs         完整通关的端到端测试
docs/                 设计文档、美术规范、测试报告
```

## 美术说明
当前**所有图像都由代码程序化绘制**，没有使用外部图片，也没有 AI 生成的位图。风格是统一的，但仍属于高质量占位资源。拿到正式的手绘 PNG 后，在 `src/art/manifest.ts` 里登记，就会自动替换。需要补齐的资产清单见 [docs/ART_GUIDE.md](docs/ART_GUIDE.md)。
