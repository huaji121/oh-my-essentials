import { world } from "@minecraft/server";

world.afterEvents.itemUse.subscribe((event) => {
  if (event.itemStack.typeId !== "ome:rabbit_doll") return;
  const dimensionId = event.source.dimension;
  dimensionId.playSound("mob.rabbit.hurt", event.source.location, { volume: 1, pitch: 1 });
});
