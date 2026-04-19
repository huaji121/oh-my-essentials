// cell.ts
import { system, Vector3, world } from "@minecraft/server";
import { packVector3, unpackCoord, PACK_MUL_Y, PACK_MUL_Z } from "../utils";
import { saveCell, loadAllCells } from "./persistence";
import { JsonStore } from "../store";

type CellSet = Map<number, Vector3>;
type CellTable = Map<string, CellSet>;

// 预计算26个邻居的 pack delta
const NEIGHBOR_PACK_DELTAS: number[] = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      if (dx !== 0 || dy !== 0 || dz !== 0) NEIGHBOR_PACK_DELTAS.push(dx + dy * PACK_MUL_Y + dz * PACK_MUL_Z);

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

  // 1. 统计邻居数（直接累加，省掉 candidates 集合）
  const neighborCount = new Map<number, number>();
  let i = 0;
  for (const [packed] of cells) {
    for (const delta of NEIGHBOR_PACK_DELTAS) {
      const np = packed + delta;
      neighborCount.set(np, (neighborCount.get(np) ?? 0) + 1);
    }
    if (++i % 200 === 0) yield;
  }

  // 2. 计算下一代
  const next: CellSet = new Map();
  i = 0;
  for (const [packed, count] of neighborCount) {
    const alive = cells.has(packed);
    if (alive && SURVIVE_SET.has(count)) {
      next.set(packed, cells.get(packed)!);
    } else if (!alive && BIRTH_SET.has(count)) {
      next.set(packed, unpackCoord(packed));
    }
    if (++i % 500 === 0) yield;
  }

  // 3. 清除死亡方块
  i = 0;
  for (const [packed, location] of cells) {
    if (!next.has(packed)) {
      try {
        dimension.setBlockType(location, "minecraft:air");
      } catch {}
    }
    if (++i % 100 === 0) yield;
  }

  // 4. 放置新生方块
  i = 0;
  for (const [packed, location] of next) {
    if (!cells.has(packed)) {
      try {
        dimension.setBlockType(location, "ome:cell");
      } catch {
        next.delete(packed);
      }
    }
    if (++i % 100 === 0) yield;
  }

  // 5. 提交结果
  cellTable.set(dimensionId, next);
  saveCell(dimensionId, next);
  world.sendMessage(`[${dimensionId}] 运行完成. 新细胞数: ${next.size}`);
}

world.afterEvents.playerPlaceBlock.subscribe((event) => {
  if (event.block.typeId !== "ome:cell") return;
  const dimensionId = event.player.dimension.id;
  const cells = getOrCreateCellSet(dimensionId);
  cells.set(packVector3(event.block.location), event.block.location);
  saveCell(dimensionId, cells);
  world.sendMessage(`[${dimensionId}] 当前细胞数: ${cells.size}`);
});

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (event.block.typeId !== "ome:cell") return;
  const dimensionId = event.player.dimension.id;
  const cells = getOrCreateCellSet(dimensionId);
  cells.delete(packVector3(event.block.location));
  saveCell(dimensionId, cells);
  world.sendMessage(`[${dimensionId}] 当前细胞数: ${cells.size}`);
});

world.beforeEvents.explosion.subscribe((event) => {
  const dimensionId = event.dimension.id;
  const cells = cellTable.get(dimensionId);
  if (!cells || cells.size === 0) return;

  let changed = false;
  for (const block of event.getImpactedBlocks()) {
    if (block.typeId !== "ome:cell") continue;
    cells.delete(packVector3(block.location));
    changed = true;
  }
  if (changed) system.run(() => saveCell(dimensionId, cells));
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
  switch (event.id) {
    case "cell:step": {
      cellTable.forEach((cells, dimensionId) => {
        if (cells.size > 0) system.runJob(stepJob(dimensionId));
      });
      break;
    }

    case "cell:step_dim": {
      const dimensionId = event.message.trim();
      if (!dimensionId) {
        world.sendMessage("用法: /scriptevent cell:step_dim <dimensionId>");
        break;
      }
      system.runJob(stepJob(dimensionId));
      break;
    }

    case "cell:run": {
      const parts = event.message.trim().split(/\s+/);
      const totalSteps = parseInt(parts[0]);
      const intervalTicks = parseInt(parts[1]);

      if (isNaN(totalSteps) || isNaN(intervalTicks) || totalSteps <= 0 || intervalTicks <= 0) {
        world.sendMessage("用法: /scriptevent cell:run <次数> <间隔ticks>");
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
                world.sendMessage(`还剩 ${remaining} 步`);
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

    case "cell:rule": {
      const parts = event.message.trim().split("/");
      if (parts.length !== 2) {
        world.sendMessage("用法: /scriptevent cell:rule <存活>/<诞生>  例: 5,6,7/6");
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
