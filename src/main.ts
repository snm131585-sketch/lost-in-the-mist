import { Game } from './game/game';

const game = new Game();
game.boot().catch((e) => {
  console.error('启动失败', e);
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#e9e4cf;font-family:sans-serif">游戏启动失败：${String(e)}</div>`);
});
