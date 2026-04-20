// utils.ts
import { Vector3 } from "@minecraft/server";

// Minecraft Bedrock 实际范围：
// X/Z: ±30,000,000 理论上限，取 ±131071 (2^17-1) 作为实用上限
// Y: -64 到 320，偏移 64 后 0~384
export const PACK_X_OFFSET = 131072; // 2^17
export const PACK_Y_OFFSET = 64;
export const PACK_Z_OFFSET = 131072; // 2^17

export const PACK_X_BITS = 18; // 0 ~ 262143
export const PACK_Y_BITS = 9; // 0 ~ 511
export const PACK_Z_BITS = 18; // 0 ~ 262143

// Z 从第0位开始，Y 从第18位，X 从第27位
// 总共 18+9+18 = 45位，安全范围内
export const PACK_SHIFT_Y = PACK_Z_BITS; // 18
export const PACK_SHIFT_X = PACK_Z_BITS + PACK_Y_BITS; // 27

export const PACK_MASK_Z = (1 << PACK_Z_BITS) - 1; // 0x3FFFF
export const PACK_MASK_Y = (1 << PACK_Y_BITS) - 1; // 0x1FF
export const PACK_MASK_X = (1 << PACK_X_BITS) - 1; // 0x3FFFF

export function packCoord(x: number, y: number, z: number): number {
  return (
    ((z + PACK_Z_OFFSET) & PACK_MASK_Z) +
    ((y + PACK_Y_OFFSET) & PACK_MASK_Y) * (1 << PACK_SHIFT_Y) +
    ((x + PACK_X_OFFSET) & PACK_MASK_X) * (1 << PACK_SHIFT_X)
  );
}

export function unpackCoord(packed: number): Vector3 {
  const z = (packed & PACK_MASK_Z) - PACK_Z_OFFSET;
  const y = ((packed / (1 << PACK_SHIFT_Y)) & PACK_MASK_Y) - PACK_Y_OFFSET;
  const x = ((packed / (1 << PACK_SHIFT_X)) & PACK_MASK_X) - PACK_X_OFFSET;
  return { x, y, z };
}

export function packVector3(vec: Vector3): number {
  return packCoord(vec.x, vec.y, vec.z);
}

// NEIGHBOR_PACK_DELTAS 也要重新计算
export const NEIGHBOR_PACK_DELTAS: number[] = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      if (dx !== 0 || dy !== 0 || dz !== 0)
        NEIGHBOR_PACK_DELTAS.push(dz + dy * (1 << PACK_SHIFT_Y) + dx * (1 << PACK_SHIFT_X));
