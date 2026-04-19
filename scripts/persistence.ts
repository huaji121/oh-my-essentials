// persistence.ts
import { Vector3 } from "@minecraft/server";
import { hashVector3 } from "./utils";
import { JsonStore } from "./JsonStore";

type CellSet = Map<number, Vector3>;
type CellTable = Map<string, CellSet>;
type SerializedCells = [number, number, number][];

const cellStore = new JsonStore<SerializedCells>("ome:cells");

function serialize(cells: CellSet): SerializedCells {
  const result: SerializedCells = [];
  cells.forEach(({ x, y, z }) => result.push([x, y, z]));
  return result;
}

function deserialize(data: SerializedCells): CellSet {
  const cells: CellSet = new Map();
  for (const [x, y, z] of data) {
    const vec: Vector3 = { x, y, z };
    cells.set(hashVector3(vec), vec);
  }
  return cells;
}

export function saveCell(dimensionId: string, cells: CellSet): void {
  cellStore.set(dimensionId, serialize(cells));
}

export function loadCell(dimensionId: string): CellSet {
  const data = cellStore.get(dimensionId);
  return data ? deserialize(data) : new Map();
}

export function loadAllCells(): CellTable {
  const table: CellTable = new Map();
  for (const [dimensionId, data] of cellStore.entries()) {
    const cells = deserialize(data);
    if (cells.size > 0) table.set(dimensionId, cells);
  }
  return table;
}
