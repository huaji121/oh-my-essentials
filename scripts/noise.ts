// noise.ts - 三维柏林噪声实现
export class Perlin3D {
  private perm: Uint8Array;

  constructor(seed: number = (Math.random() * 65536) | 0) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle with seed
    let s = seed;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      const j = (s >>> 0) % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }
  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  }

  sample(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = this.fade(x),
      v = this.fade(y),
      w = this.fade(z);
    const p = this.perm;
    const A = p[X] + Y,
      B = p[X + 1] + Y;
    return this.lerp(
      this.lerp(
        this.lerp(this.grad(p[A + Z], x, y, z), this.grad(p[B + Z], x - 1, y, z), u),
        this.lerp(this.grad(p[A + Z + 1], x, y - 1, z), this.grad(p[B + Z + 1], x - 1, y - 1, z), u),
        v
      ),
      this.lerp(
        this.lerp(this.grad(p[A + Z + 1], x, y, z - 1), this.grad(p[B + Z + 1], x - 1, y, z - 1), u),
        this.lerp(this.grad(p[A + Z + 1], x, y - 1, z - 1), this.grad(p[B + Z + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }
}
