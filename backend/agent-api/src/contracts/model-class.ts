export const conversationModelClasses = ["default", "lightweight", "decision"] as const;
export type ConversationModelClass = typeof conversationModelClasses[number];
