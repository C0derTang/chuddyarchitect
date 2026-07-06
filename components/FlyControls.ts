import * as THREE from "three";

// Drone-style fly controls:
//   mouse (pointer-locked after canvas click, or drag) — pitch / yaw
//   W/S — forward/back   A/D — strafe   Q/E — down/up   Shift — boost
//   scroll wheel — adjust speed
// Orientation is yaw+pitch relative to a configurable up axis (no roll), so
// scenes with unusual up vectors (nerfstudio is often +Z) still fly sanely.
export class FlyControls {
  speed = 2.5; // m/s
  sensitivity = 0.0022; // rad per px
  enabled = true;

  private camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;
  private keys = new Set<string>();
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private up = new THREE.Vector3(0, 1, 0);
  private basis = new THREE.Quaternion(); // rotates +Y into `up`
  private dragging = false;
  private dragMoved = 0;
  private raf = 0;
  private lastT = 0;
  private disposers: (() => void)[] = [];

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    this.syncFromCamera();

    const on = <K extends keyof GlobalEventHandlersEventMap>(
      target: EventTarget,
      type: string,
      fn: (e: GlobalEventHandlersEventMap[K]) => void,
      opts?: AddEventListenerOptions
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on<"keydown">(window, "keydown", (e) => {
      const t = e.target as HTMLElement;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      this.keys.add(e.code);
    });
    on<"keyup">(window, "keyup", (e) => this.keys.delete(e.code));
    on<"blur">(window, "blur", () => this.keys.clear());

    // click (without drag) → pointer lock for mouse-look
    on<"click">(this.dom, "click", () => {
      if (!this.enabled || this.dragMoved > 4) return;
      this.dom.requestPointerLock?.();
    });
    on<"mousemove">(document, "mousemove", (e) => {
      if (document.pointerLockElement === this.dom) this.look(e.movementX, e.movementY);
    });

    // drag-look fallback (works without pointer lock, incl. touch via pointer events)
    on<"pointerdown">(this.dom, "pointerdown", (e) => {
      if (document.pointerLockElement === this.dom) return;
      this.dragging = true;
      this.dragMoved = 0;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    });
    on<"pointermove">(this.dom, "pointermove", (e) => {
      if (!this.dragging || document.pointerLockElement === this.dom) return;
      this.dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
      this.look(e.movementX, e.movementY);
    });
    on<"pointerup">(this.dom, "pointerup", () => (this.dragging = false));

    on<"wheel">(this.dom, "wheel", (e) => {
      e.preventDefault();
      this.speed = Math.min(30, Math.max(0.2, this.speed * Math.exp(-e.deltaY * 0.001)));
    }, { passive: false });

    this.lastT = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - this.lastT) / 1000, 0.1);
      this.lastT = now;
      this.update(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setUp(x: number, y: number, z: number) {
    this.up.set(x, y, z).normalize();
    this.basis.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.up);
    this.syncFromCamera();
  }

  // Re-derive yaw/pitch from the camera's current orientation (dropping any
  // roll relative to the up axis). Call after anything else moves the camera.
  syncFromCamera() {
    const local = this.basis.clone().invert().multiply(this.camera.quaternion);
    const e = new THREE.Euler().setFromQuaternion(local, "YXZ");
    this.yaw = e.y;
    this.pitch = THREE.MathUtils.clamp(e.x, -1.55, 1.55);
    this.applyRotation();
  }

  private look(dx: number, dy: number) {
    if (!this.enabled) return;
    this.yaw -= dx * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * this.sensitivity, -1.55, 1.55);
    this.applyRotation();
  }

  private applyRotation() {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    this.camera.quaternion.copy(this.basis).multiply(q);
  }

  private update(dt: number) {
    if (!this.enabled) {
      this.vel.set(0, 0, 0);
      return;
    }
    const k = this.keys;
    const fwd = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const right = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    const lift = (k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0);

    const target = new THREE.Vector3();
    target.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion), fwd);
    target.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), right);
    target.addScaledVector(this.up, lift);
    if (target.lengthSq() > 1) target.normalize();
    target.multiplyScalar(this.speed * (k.has("ShiftLeft") || k.has("ShiftRight") ? 3 : 1));

    // exponential smoothing → gentle accelerate/brake, drone-like
    const blend = 1 - Math.exp(-8 * dt);
    this.vel.lerp(target, blend);
    if (this.vel.lengthSq() > 1e-8) this.camera.position.addScaledVector(this.vel, dt);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
