export class TrainFocusSession {
  private focusedServiceUid: string | undefined;

  get serviceUid(): string | undefined {
    return this.focusedServiceUid;
  }

  start(serviceUid: string): void {
    this.focusedServiceUid = serviceUid;
  }

  end(): void {
    this.focusedServiceUid = undefined;
  }
}
