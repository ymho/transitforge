/** Safe categories, distinct from business rejection and uncertain network failures. */
export class ApiAuthenticationError extends Error {
  constructor(readonly code: "unauthenticated" | "forbidden" | "session-changed") {
    super(code === "forbidden" ? "この操作を行う権限がありません" : "ログイン状態が変わりました。再認証して内容を確認してください");
  }
}
