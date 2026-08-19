export type McpRuntimeStatus = "stopped" | "starting" | "running" | "error";

export type RuntimeOptions = {
  autoStartOnBoot: boolean;
  autoStartDelayMs: number;
  showTopbarStatus: boolean;
};

export class McpRuntimeController {
  private status: McpRuntimeStatus = "stopped";
  private message = "未启动";
  private options: RuntimeOptions;

  public constructor(options: RuntimeOptions) {
    this.options = options;
  }

  public getStatus(): { status: McpRuntimeStatus; message: string } {
    return { status: this.status, message: this.message };
  }

  public isRunning(): boolean {
    return this.status === "running";
  }

  public getOptions(): RuntimeOptions {
    return { ...this.options };
  }

  public updateOptions(next: Partial<RuntimeOptions>): void {
    this.options = { ...this.options, ...next };
  }

  public getTopbarView(): { visible: boolean; text: string } {
    const map: Record<McpRuntimeStatus, string> = {
      stopped: "MCP: 已停止",
      starting: "MCP: 启动中",
      running: "MCP: 运行中",
      error: "MCP: 异常"
    };
    return {
      visible: this.options.showTopbarStatus,
      text: map[this.status]
    };
  }

  public markStarting(): void {
    this.status = "starting";
    this.message = "启动中";
  }

  public markRunning(message = "运行中"): void {
    this.status = "running";
    this.message = message;
  }

  public markError(error: unknown): void {
    this.status = "error";
    this.message = error instanceof Error ? error.message : String(error);
  }

  public scheduleReadyCheck(startAction: () => Promise<void>): void {
    void startAction().catch((error) => {
      this.message = error instanceof Error ? error.message : String(error);
    });
  }
}
