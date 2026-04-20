// cell.ts
import { system, Vector3, world } from "@minecraft/server";
// cell.ts 顶部
import { packVector3, unpackCoord, NEIGHBOR_PACK_DELTAS, packCoord } from "../utils";
// 删掉原来手动计算 NEIGHBOR_PACK_DELTAS 的那个 for 循环
import { saveCell, loadAllCells } from "./persistence";
import { JsonStore } from "../store";
import { Perlin3D } from "../noise";

type CellSet = Map<number, Vector3>;
type CellTable = Map<string, CellSet>;

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

let runCancelled = false;

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

      runCancelled = false;
      let remaining = totalSteps;
      let running = false;

      const runNext = () => {
        if (runCancelled) {
          world.sendMessage("自动运行已终止");
          return;
        }
        if (remaining <= 0) {
          world.sendMessage("自动运行完成");
          return;
        }
        if (running) {
          system.runTimeout(runNext, intervalTicks);
          return;
        }

        // 检查是否有细胞可以运行
        const activeDimensions = [...cellTable.entries()].filter(([, cells]) => cells.size > 0);
        if (activeDimensions.length === 0) {
          world.sendMessage("没有细胞，自动运行已终止");
          return;
        }

        running = true;
        let pending = 0;
        activeDimensions.forEach(([dimensionId]) => {
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

        remaining--;
        system.runTimeout(runNext, intervalTicks);
      };
      runNext();
      break;
    }

    case "cell:stop": {
      runCancelled = true;
      break;
    }

    case "cell:rule": {
      const parts = event.message.trim().split("/");
      if (parts.length !== 2) {
        world.sendMessage("用法: /scriptevent dbg:rule <诞生>/<存活>  例: 6/5,6,7");
        break;
      }

      const parseSets = (s: string) =>
        new Set(
          s
            .split(",")
            .map(Number)
            .filter((n) => !isNaN(n) && n >= 0 && n <= 26)
        );

      const newBirth = parseSets(parts[0]); // 原来是 newSurvive
      const newSurvive = parseSets(parts[1]); // 原来是 newBirth

      if (newSurvive.size === 0 || newBirth.size === 0) {
        world.sendMessage("规则格式错误，数字范围 0-26");
        break;
      }

      SURVIVE_SET = newSurvive;
      BIRTH_SET = newBirth;
      ruleStore.set("current", { survive: [...newSurvive], birth: [...newBirth] });
      world.sendMessage(`规则已设为 B${[...newBirth].join(",")} / S${[...newSurvive].join(",")}`);
      break;
    }

    case "cell:fill": {
      const parts = event.message.trim().split(/\s+/);
      const radius = parseInt(parts[0]);
      const threshold = parseFloat(parts[1]) * 2 - 1; // 映射到柏林噪声范围 [-1, 1]
      const scale = parseFloat(parts[2] ?? "0.1");
      const seed = parts[3] ? parseInt(parts[3]) : (Math.random() * 65536) | 0;

      if (isNaN(radius) || isNaN(threshold) || radius <= 0) {
        world.sendMessage("用法: /scriptevent cell:fill <半径> <密度0~1> [噪声缩放] [seed]");
        break;
      }

      // 取第一个玩家的位置和维度
      const player = [...world.getPlayers()][0];
      if (!player) {
        world.sendMessage("没有玩家");
        break;
      }

      const cx = Math.floor(player.location.x);
      const cy = Math.floor(player.location.y);
      const cz = Math.floor(player.location.z);
      const dimensionId = player.dimension.id;
      const cells = getOrCreateCellSet(dimensionId);
      const noise = new Perlin3D(seed);

      world.sendMessage(`开始生成... 半径=${radius} 密度=${parts[1]} 缩放=${scale} seed=${seed}`);

      system.runJob(
        (function* (): Generator<void, void, void> {
          let added = 0;
          let i = 0;
          for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dz = -radius; dz <= radius; dz++) {
                // 球形范围
                if (dx * dx + dy * dy + dz * dz > radius * radius) continue;

                const nx = noise.sample((cx + dx) * scale, (cy + dy) * scale, (cz + dz) * scale);

                if (nx > threshold) {
                  const x = cx + dx,
                    y = cy + dy,
                    z = cz + dz;
                  const packed = packCoord(x, y, z);
                  if (!cells.has(packed)) {
                    const vec = { x, y, z };
                    cells.set(packed, vec);
                    try {
                      player.dimension.setBlockType(vec, "ome:cell");
                    } catch {}
                    added++;
                  }
                }

                if (++i % 200 === 0) yield;
              }
            }
            yield; // 每层 dx 额外让出一次
          }

          saveCell(dimensionId, cells);
          world.sendMessage(`生成完成，新增 ${added} 个细胞，当前共 ${cells.size} 个`);
        })()
      );
      break;
    }
  }
});
