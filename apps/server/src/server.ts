/// <reference types="node" />
import { startServer } from "./app";
import { UsageError, serverOptionsFromArgs } from "./args";
import { ConfigError } from "./config";

// Entry point of dist/server.mjs:  node dist/server.mjs --data <dir> --web <dir> --port 8787
async function main(): Promise<void> {
  const running = await startServer(serverOptionsFromArgs(process.argv.slice(2)));
  console.log(`Gap Assessment server (storage: ${running.app.config.storage}) listening on http://127.0.0.1:${running.port}`);
  console.log("Only this computer can reach that address. Publish it with Tailscale serve or funnel.");

  const stop = () => {
    console.log("Stopping.");
    void running.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  if (err instanceof UsageError || err instanceof ConfigError) console.error(err.message);
  else if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") console.error("That port is already in use. Choose another with --port.");
  else console.error("The server could not start:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
