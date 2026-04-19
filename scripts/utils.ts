// utils.ts
import { Vector3 } from "@minecraft/server";

export const PACK_OFFSET = 512;
export const PACK_MUL_Y = 1024;
export const PACK_MUL_Z = 1024 * 1024;

export function packCoord(x: number, y: number, z: number): number {
  return ((x + PACK_OFFSET) | 0) + ((y + PACK_OFFSET) | 0) * PACK_MUL_Y + ((z + PACK_OFFSET) | 0) * PACK_MUL_Z;
}

export function unpackCoord(packed: number): Vector3 {
  const z = ((packed / PACK_MUL_Z) | 0) - PACK_OFFSET;
  const y = (((packed % PACK_MUL_Z) / PACK_MUL_Y) | 0) - PACK_OFFSET;
  const x = (packed % PACK_MUL_Y) - PACK_OFFSET;
  return { x, y, z };
}

export function packVector3(vec: Vector3): number {
  return packCoord(vec.x, vec.y, vec.z);
}

export function hashCoord(x: number, y: number, z: number): number {
  const h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  return h >>> 0;
}

export function hashVector3(vec: Vector3): number {
  return hashCoord(vec.x, vec.y, vec.z);
}
