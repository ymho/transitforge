/** Create a fresh server conversation only for an explicit first submission.
 * Navigation/account validity must be checked after both async boundaries: a
 * history load may finish after the user has selected a different Trip/chat. */
export async function startFreshConsultation(prompt: string, ports: {
  create(): Promise<{ id: string }>;
  activate(id: string): Promise<void>;
  isCurrent(): boolean;
  currentConversationId(): string;
  submit(prompt: string): void;
}): Promise<void> {
  const check = () => { if (!ports.isCurrent()) throw new Error("Consultation navigation changed"); };
  check();
  const session = await ports.create();
  check();
  await ports.activate(session.id);
  check();
  if (ports.currentConversationId() !== session.id) throw new Error("Consultation target changed");
  ports.submit(prompt);
}
