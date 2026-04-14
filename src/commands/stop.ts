import { stopAll } from "../lib/services.js";

export function stop(): void {
  console.log("");
  console.log("  Stopping fellow-agents...");
  stopAll();
  console.log("  Done.");
  console.log("");
}
