// 输入：键盘 + 虚拟摇杆（触屏）

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  /** 摇杆向量 -1..1 */
  stick = { x: 0, y: 0, active: false };
  actionHeld = false;
  private actionTap = false;
  potionTap = false;
  touchUsed = false;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.stick.x = this.stick.y = 0; this.stick.active = false; this.actionHeld = false; });
    window.addEventListener('touchstart', () => { this.touchUsed = true; }, { passive: true });
  }

  isDown(...ks: string[]) { return this.enabled && ks.some((k) => this.keys.has(k)); }
  /** 本帧刚按下 */
  wasPressed(...ks: string[]) { return ks.some((k) => this.pressed.has(k)); }
  consumeAction(): boolean {
    const t = this.actionTap || (this.enabled && this.wasPressed('e', ' '));
    this.actionTap = false;
    return t;
  }
  tapAction() { this.actionTap = true; }
  endFrame() { this.pressed.clear(); this.potionTap = false; }

  /** 移动向量（已归一化） */
  move(): { x: number; y: number; slow: boolean } {
    if (!this.enabled) return { x: 0, y: 0, slow: false };
    let x = 0, y = 0;
    if (this.isDown('a', 'arrowleft')) x -= 1;
    if (this.isDown('d', 'arrowright')) x += 1;
    if (this.isDown('w', 'arrowup')) y -= 1;
    if (this.isDown('s', 'arrowdown')) y += 1;
    if (this.stick.active) { x += this.stick.x; y += this.stick.y; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y, slow: this.isDown('shift') };
  }

  /** 绑定虚拟摇杆 DOM */
  bindTouch(zone: HTMLElement, base: HTMLElement, knob: HTMLElement, actBtn: HTMLElement, potionBtn: HTMLElement) {
    let id: number | null = null;
    let cx = 0, cy = 0;
    const R = 52;
    const baseHome = () => { base.style.left = ''; base.style.top = ''; base.style.bottom = ''; };
    const setKnob = (dx: number, dy: number) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const zr = zone.getBoundingClientRect();
      // 摇杆跟随手指按下的位置出现
      base.style.left = `${e.clientX - zr.left - 64}px`;
      base.style.top = `${e.clientY - zr.top - 64}px`;
      base.style.bottom = 'auto';
      cx = e.clientX; cy = e.clientY;
      this.stick.active = true;
      this.touchUsed = true;
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      setKnob(dx, dy);
      const dead = 0.15;
      const m = Math.min(1, l / R);
      this.stick.x = m > dead ? dx / R : 0;
      this.stick.y = m > dead ? dy / R : 0;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick.active = false;
      this.stick.x = this.stick.y = 0;
      setKnob(0, 0);
      baseHome();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    actBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.actionHeld = true; this.tapAction(); actBtn.classList.add('down'); });
    const actUp = () => { this.actionHeld = false; actBtn.classList.remove('down'); };
    actBtn.addEventListener('pointerup', actUp);
    actBtn.addEventListener('pointercancel', actUp);
    actBtn.addEventListener('pointerleave', actUp);
    potionBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.potionTap = true; });
  }
}
