import { world } from "@minecraft/server";

world.afterEvents.chatSend.subscribe((event) => {
  const message = event.message;
  if (message === "hello") {
    world.sendMessage("Hello, " + event.sender.name + "!");
  }
});

world.beforeEvents.explosion.subscribe((event) => {
  const location = event.source?.location;
  if (!location) return;
  location.y -= 1;
  const block = event.dimension.getBlock(location);

  if (!block) return;
  event.setImpactedBlocks([block]);
});
