import { mountZombieGame } from "./zombie-game.mjs";
import { createRouteView } from "./coop-route-view.mjs";
export { createCoopRouteWorld, COOP_STEP, COOP_PROTOCOL } from "./coop-route-world.mjs";
import "./coop-route.css";

export async function mountCoopRoute(host, options) {
  const simulation = createRouteView(options);
  try { return await mountZombieGame(host, { ...options, simulation, cooperative: true }); }
  catch (error) { simulation.dispose(); throw error; }
}
