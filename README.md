# Lost in the Mist · 迷雾拾荒者

一款 2D 俯视角**开放世界生存**网页游戏。你在被迷雾笼罩的森林里醒来，要采集、制作、建造篝火熬过黑夜、和雾狼战斗，并最终唤醒北方的森林祭坛。

> **v2 生存版**（当前分支 `survival-upgrade`）：生命、饥饿、精神、体温四项属性；昼夜循环和夜间黑暗；工具耐久；建造篝火与储物箱；烹饪；生物与战斗；降雨；永久死亡。
> **v1 探索版**保留在标签 `v1.0-explore`，线上地址 https://snm131585-sketch.github.io/lost-in-the-mist/ 目前仍是 v1。

玩法和数值见 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)，架构和升级日志见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，测试结果见 [docs/TEST_REPORT.md](docs/TEST_REPORT.md)，美术规范见 [docs/ART_GUIDE.md](docs/ART_GUIDE.md)。

## 操作
WASD / 方向键移动，E 互动，F 或鼠标左键攻击，1–0 使用物品栏，C 打开制作，M 打开地图，Q 喝药水，Esc 暂停。
手机上：左下是摇杆，右下是「互动」「攻击」「药」按钮，点物品栏可以使用物品。

## 技术栈（以及和原定方案的差异）
| 原定 | 实际 | 原因 |
|---|---|---|
| Phaser | 自研轻量 Canvas 2D 引擎（`src/engine`、`src/game/`） | 开发环境的网络策略拒绝访问 npm 仓库（403），Phaser 装不上 |
| Vite | 开发环境里用 esbuild 构建（`scripts/build.mjs`）；`vite.config.ts` 和 `npm run dev` 也已配好 | 原因同上。Vite 配置没有在开发环境里实际运行过 |
| TypeScript / HTML / CSS / LocalStorage / Git | 都已使用 | — |

配置表（`src/data/`）和纯逻辑系统（`src/systems/`、`src/game/state.ts`）不依赖任何引擎，以后迁移到 Phaser 时可以直接复用。

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
node scripts/build.mjs   # 生成 dist/index.html（约 180 KB，所有资源都内联在里面）
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
index.html            页面结构
src/styles.css        UI 样式
src/data/             配置表：物品、资源节点、建筑、生物、配方、旅程
src/systems/          纯逻辑：背包、生存、时间、天气、生物、建造
src/game/             state（存档与制作）· game（主控）· render（渲染）
src/world/            地图生成、地面烘焙、迷雾
src/art/              程序化美术与资源替换接口
src/engine/           数学、输入、音频
src/ui/               DOM 界面
tests/e2e.mjs         v2 端到端测试（60 项）
docs/                 设计、开发、美术、测试文档
```

## 美术说明
当前**所有图像都由代码程序化绘制**，没有使用外部图片，也没有 AI 生成的位图。风格是统一的，但仍属于高质量占位资源。拿到正式的手绘 PNG 后，在 `src/art/manifest.ts` 里登记，就会自动替换。需要补齐的资产清单见 [docs/ART_GUIDE.md](docs/ART_GUIDE.md)。
