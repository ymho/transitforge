export interface HotPepperCredentialsRepository { load(): Promise<{ apiKey: string } | undefined> }
