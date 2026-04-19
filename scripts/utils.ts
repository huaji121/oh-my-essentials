import { Vector3 } from "@minecraft/server";

export function hashCoord(x: number, y: number, z: number): number {
  // 大质数乘子，确保各维度独立性
  const h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  return h >>> 0; // 转为无符号32位整数
}

export function hashVector3(vec: Vector3): number {
  return hashCoord(vec.x, vec.y, vec.z);
}
