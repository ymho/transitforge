import type { ContextWorkspaceState } from "./context-workspace";

export interface TrainFocusReturnContext {
  workspace: ContextWorkspaceState;
  mobileContextOpen: boolean;
}

/** 列車フォーカス中の再描画では戻り先を上書きしない。 */
export class TrainFocusReturnContextSession {
  private returnContext?: TrainFocusReturnContext;

  start(workspace: ContextWorkspaceState, mobileContextOpen: boolean): void {
    this.returnContext ??= {
      workspace: structuredClone(workspace),
      mobileContextOpen,
    };
  }

  end(): TrainFocusReturnContext | undefined {
    const context = this.returnContext;
    this.returnContext = undefined;
    return context ? structuredClone(context) : undefined;
  }
}
