// cell.ts
import { system, Vector3, world } from "@minecraft/server";
import { hashVector3 } from "./utils";
import { saveCell, loadAllCells } from "./persistence";
import { JsonStore } from "./JsonStore";

type CellSet = Map<number, Vector3>;
type CellTable = Map<string, CellSet>;

// 预计算26个邻居偏移
const NEIGHBOR_OFFSETS: Vector3[] = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      if (dx !== 0 || dy !== 0 || dz !== 0) NEIGHBOR_OFFSETS.push({ x: dx, y: dy, z: dz });

// 规则
let SURVIVE_SET = new Set([5, 6, 7]);
let BIRTH_SET = new Set([6]);

const ruleStore = new JsonStore<{ survive: number[]; birth: number[] }>("ome:rules");
const cellTable: CellTable = new Map();

world.afterEvents.worldLoad.subscribe(() => {
  const savedRule = ruleStore.get("current");
  if (savedRule) {
    SURVIVE_SET = new Set(savedRule.survive);
    BIRTH_SET = new Set(savedRule.birth);
  }

  for (const [dimensionId, cells] of loadAllCells()) {
    cellTable.set(dimensionId, cells);
  }
});

function getOrCreateCellSet(dimensionId: string): CellSet {
  if (!cellTable.has(dimensionId)) {
    cellTable.set(dimensionId, new Map());
  }
  return cellTable.get(dimensionId)!;
}

function* stepJob(dimensionId: string): Generator<void, void, void> {
  const cells = getOrCreateCellSet(dimensionId);
  const dimension = world.getDimension(dimensionId);

  // 1. 收集候选格子
  const candidates: CellSet = new Map();
  let i = 0;
  for (const [, location] of cells) {
    for (const off of NEIGHBOR_OFFSETS) {
      const c: Vector3 = { x: location.x + off.x, y: location.y + off.y, z: location.z + off.z };
      candidates.set(hashVector3(c), c);
    }
    if (++i % 50 === 0) yield;
  }

  // 2. 计算下一代
  const next: CellSet = new Map();
  i = 0;
  for (const [, location] of candidates) {
    let count = 0;
    for (const off of NEIGHBOR_OFFSETS) {
      const n: Vector3 = { x: location.x + off.x, y: location.y + off.y, z: location.z + off.z };
      if (cells.has(hashVector3(n))) count++;
    }
    const alive = cells.has(hashVector3(location));
    if (alive && SURVIVE_SET.has(count)) {
      next.set(hashVector3(location), location);
    } else if (!alive && BIRTH_SET.has(count)) {
      next.set(hashVector3(location), location);
    }
    if (++i % 100 === 0) yield;
  }

  // 3. 清除死亡方块
  i = 0;
  for (const [hash, location] of cells) {
    if (!next.has(hash)) {
      try {
        dimension.setBlockType(location, "minecraft:air");
      } catch {}
    }
    if (++i % 50 === 0) yield;
  }

  // 4. 放置新生方块
  i = 0;
  for (const [hash, location] of next) {
    if (!cells.has(hash)) {
      try {
        dimension.setBlockType(location, "ome:cell");
      } catch {
        next.delete(hash);
      }
    }
    if (++i % 50 === 0) yield;
  }

  // 5. 提交结果
  cellTable.set(dimensionId, next);
  saveCell(dimensionId, next);
  world.sendMessage(`[${dimensionId}] Stepped. cells: ${next.size}`);
}

world.afterEvents.playerPlaceBlock.subscribe((event) => {
  if (event.block.typeId !== "ome:cell") return;
  const dimensionId = event.player.dimension.id;
  const cells = getOrCreateCellSet(dimensionId);
  cells.set(hashVector3(event.block.location), event.block.location);
  saveCell(dimensionId, cells);
  world.sendMessage(`[${dimensionId}] Current cells: ${cells.size}`);
});

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (event.block.typeId !== "ome:cell") return;
  const dimensionId = event.player.dimension.id;
  const cells = getOrCreateCellSet(dimensionId);
  cells.delete(hashVector3(event.block.location));
  saveCell(dimensionId, cells);
  world.sendMessage(`[${dimensionId}] Current cells: ${cells.size}`);
});

world.beforeEvents.explosion.subscribe((event) => {
  const dimensionId = event.dimension.id;
  const cells = cellTable.get(dimensionId);
  if (!cells || cells.size === 0) return;

  let changed = false;
  for (const block of event.getImpactedBlocks()) {
    if (block.typeId !== "ome:cell") continue;
    cells.delete(hashVector3(block.location));
    changed = true;
  }

  if (changed) {
    system.run(() => saveCell(dimensionId, cells));
  }
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
  switch (event.id) {
    case "dbg:step": {
      cellTable.forEach((cells, dimensionId) => {
        if (cells.size > 0) system.runJob(stepJob(dimensionId));
      });
      break;
    }

    case "dbg:step_dim": {
      const dimensionId = event.message.trim();
      if (!dimensionId) {
        world.sendMessage("用法: /scriptevent dbg:step_dim <dimensionId>");
        break;
      }
      system.runJob(stepJob(dimensionId));
      break;
    }

    case "dbg:run": {
      const parts = event.message.trim().split(/\s+/);
      const totalSteps = parseInt(parts[0]);
      const intervalTicks = parseInt(parts[1]);

      if (isNaN(totalSteps) || isNaN(intervalTicks) || totalSteps <= 0 || intervalTicks <= 0) {
        world.sendMessage("用法: /scriptevent dbg:run <次数> <间隔ticks>");
        break;
      }

      let remaining = totalSteps;
      let running = false;

      const runNext = () => {
        if (remaining <= 0) {
          world.sendMessage("自动运行完成");
          return;
        }
        if (running) {
          system.runTimeout(runNext, intervalTicks);
          return;
        }

        running = true;
        let pending = 0;
        cellTable.forEach((cells, dimensionId) => {
          if (cells.size === 0) return;
          pending++;
          system.runJob(
            (function* (): Generator<void, void, void> {
              yield* stepJob(dimensionId);
              if (--pending === 0) {
                running = false;
                world.sendMessage(`Remaining steps: ${remaining}`); // 加这行
              }
            })()
          );
        });
        if (pending === 0) running = false;

        remaining--;
        system.runTimeout(runNext, intervalTicks);
      };
      runNext();
      break;
    }

    case "dbg:rule": {
      const parts = event.message.trim().split("/");
      if (parts.length !== 2) {
        world.sendMessage("用法: /scriptevent dbg:rule <存活>/<诞生>  例: 5,6,7/6");
        break;
      }

      const parseSets = (s: string) =>
        new Set(
          s
            .split(",")
            .map(Number)
            .filter((n) => !isNaN(n) && n >= 0 && n <= 26)
        );

      const newSurvive = parseSets(parts[0]);
      const newBirth = parseSets(parts[1]);

      if (newSurvive.size === 0 || newBirth.size === 0) {
        world.sendMessage("规则格式错误，数字范围 0-26");
        break;
      }

      SURVIVE_SET = newSurvive;
      BIRTH_SET = newBirth;
      ruleStore.set("current", { survive: [...newSurvive], birth: [...newBirth] });
      world.sendMessage(`规则已设为 ${[...newSurvive].join(",")}/${[...newBirth].join(",")}`);
      break;
    }
  }
});
