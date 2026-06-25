import { Container } from "@cloudflare/containers";

export class BeachcarRunnerContainer extends Container<Env> {
  defaultPort = 8788;
  requiredPorts = [8788];
  sleepAfter = "5m";
  enableInternet = true;
  pingEndpoint = "/health";

  onStart(): void {
    console.log(JSON.stringify({ level: "info", message: "Beachcar runner container started" }));
  }

  onStop(params: { exitCode: number; reason: "exit" | "runtime_signal" }): void {
    console.log(JSON.stringify({ level: "info", message: "Beachcar runner container stopped", ...params }));
  }

  onError(error: unknown): unknown {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: "error", message: "Beachcar runner container error", error: message }));
    throw error;
  }
}
