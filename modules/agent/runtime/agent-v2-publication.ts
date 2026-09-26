import type { Evidence, EvidenceClaim } from "./evidence-model";
import type { EffectiveIntent } from "./effective-intent";
import { AgentV2ReplyError, parseAgentV2Reply, type AgentV2OperationReceipt, type AgentV2ReplyProof,
  type ReplyOperation, type ReplyQuestion } from "./agent-v2-reply";
import { parsePublicPlacePresentation, publicPlacePresentationVersion, publicPlaceSourceUrl,
  type PublicPlaceCard, type PublicPlacePresentation } from "./public-place-presentation";

export interface AgentV2ReplyContext {
  executionId: string;
  evidence: readonly Evidence[];
  effectiveIntent?: EffectiveIntent;
  /** Supplied only by authenticated Application composition, never model JSON. */
  receipts?: readonly AgentV2OperationReceipt[];
  availableOperations?: readonly ReplyOperation[];
}
export interface AgentV2AdmittedReply {
  text: string;
  evidence: Evidence[];
  claims: EvidenceClaim[];
  proof: AgentV2ReplyProof;
  publicPlacePresentation?: PublicPlacePresentation;
}
const operationLabels: Record<ReplyOperation, string> = { save: "保存", change: "変更", book: "予約", pay: "決済" };
const conversationText = {
  greeting: "こんにちは。旅について相談したいことを教えてください。",
  thanks: "どういたしまして。",
  acknowledgement: "承知しました。",
};
const questions: Record<ReplyQuestion, string> = {
  goal: "どのような旅にしたいですか？", origin: "どこから出発しますか？", destination: "行き先はどちらですか？",
  start_date: "出発日はいつですか？", duration: "何日間の旅を考えていますか？",
  party_size: "何人での旅行ですか？", budget: "今回の旅行の予算を教えてください。",
};

/** Resolve references and operation status from trusted inputs. Never infer success
 * from prose, and never let a model-declared kind authorize arbitrary payloads. */
export function admitAgentV2Reply(value: unknown, context: AgentV2ReplyContext): AgentV2AdmittedReply {
  const proposal = parseAgentV2Reply(value);
  const proof: AgentV2ReplyProof = { kind: proposal.kind, references: [] };
  const reply = (text: string): AgentV2AdmittedReply => ({ text, evidence: [], claims: [], proof });
  switch (proposal.kind) {
    case "conversation": return reply(conversationText[proposal.message]);
    case "uncertainty": return reply("必要な情報をまだ確認できていません。未確認の内容を確定情報としては案内できません。");
    case "clarification":
      if (knownCondition(context.effectiveIntent, proposal.target)) throw new AgentV2ReplyError("known_condition");
      proof.question = proposal.target;
      return reply(questions[proposal.target]);
    case "unavailable":
      if (context.availableOperations?.includes(proposal.operation)) throw new AgentV2ReplyError("operation_available");
      proof.operation = { type: proposal.operation, status: "unavailable" };
      return reply(`この会話では${operationLabels[proposal.operation]}を実行できません。${operationLabels[proposal.operation]}は行っていません。`);
    case "operation_result": {
      const matches = context.receipts?.filter(({ id }) => id === proposal.receiptId) ?? [];
      const receipt = matches[0];
      if (matches.length !== 1 || !receipt || receipt.executionId !== context.executionId || receipt.status !== "succeeded" ||
          !Object.hasOwn(operationLabels, receipt.operation)) throw new AgentV2ReplyError("invalid_receipt");
      proof.operation = { type: receipt.operation, status: "succeeded", receiptId: receipt.id };
      return reply(`${operationLabels[receipt.operation]}しました。`);
    }
    case "candidates": {
      const selected = proposal.evidenceIds.map((id) => {
        const matches = context.evidence.filter((item) => item.id === id);
        if (matches.length !== 1) throw new AgentV2ReplyError("missing_evidence");
        return matches[0]!;
      });
      let publicPlacePresentation: PublicPlacePresentation;
      try {
        publicPlacePresentation = parsePublicPlacePresentation({ version: publicPlacePresentationVersion,
          cards: selected.map((item) => placeCard(item, context.effectiveIntent)) });
      } catch (error) {
        if (error instanceof AgentV2ReplyError) throw error;
        throw new AgentV2ReplyError("invalid_field");
      }
      const claims: EvidenceClaim[] = [];
      const bindings: NonNullable<EvidenceClaim["bindings"]> = [];
      publicPlacePresentation.cards.forEach((card, index) => {
        const evidence = selected[index]!;
        for (const [field, statement, transform] of [
          ["sourceTitle", card.title, "identity"], ["sourceExcerpt", card.description, "bounded_quote"],
        ] as const) {
          const binding = { evidenceId: evidence.id, fieldPath: `facts.${field}`, subjectRef: card.placeRef,
            applicabilityScope: evidence.observation!.scopeKey };
          proof.references.push({ evidenceId: evidence.id, field });
          claims.push({ id: `v2-place-${claims.length + 1}`, statement, kind: "fact", evidenceIds: [evidence.id], bindings: [{ ...binding, transform }] });
          bindings.push({ ...binding, transform: "recommendation" });
        }
      });
      const commentary = boundedText(proposal.commentary);
      proof.commentary = true;
      claims.push({ id: "v2-commentary", statement: commentary, kind: "inference", evidenceIds: [...proposal.evidenceIds], bindings });
      return { text: escapeMarkdown(commentary), evidence: selected.map((item) => structuredClone(item)), claims, proof, publicPlacePresentation };
    }
    case "answer": {
      const selected = new Map<string, Evidence>();
      const claims: EvidenceClaim[] = [];
      const parts: string[] = [];
      const commentaryBindings: NonNullable<EvidenceClaim["bindings"]> = [];
      for (const reference of proposal.references) {
        const matches = context.evidence.filter(({ id }) => id === reference.evidenceId);
        if (matches.length !== 1) throw new AgentV2ReplyError("missing_evidence");
        const evidence = matches[0]!;
        assertEvidence(evidence, context.effectiveIntent);
        if (!publicReplyField(reference.field) || !Object.hasOwn(evidence.facts, reference.field)) throw new AgentV2ReplyError("invalid_field");
        const fact = evidence.facts[reference.field];
        if (fact === null || fact === undefined || Array.isArray(fact) && !fact.length) throw new AgentV2ReplyError("invalid_field");
        const text = factText(fact);
        const subject = boundedText(evidence.subject);
        const quotation = reference.field === "sourceExcerpt";
        parts.push(`${escapeMarkdown(subject)}\n\n${quotation ? "> " : ""}${escapeMarkdown(text).replaceAll("\n", quotation ? "\n> " : "\n")}\n${sourceLink(evidence)}`.trim());
        selected.set(evidence.id, structuredClone(evidence));
        const binding = { evidenceId: evidence.id, fieldPath: `facts.${reference.field}`,
          subjectRef: evidence.observation?.subjectKey ?? evidence.subject,
          ...(evidence.observation?.scopeKey ? { applicabilityScope: evidence.observation.scopeKey } : {}) };
        claims.push({ id: `v2-claim-${claims.length + 1}`, statement: text, kind: "fact", evidenceIds: [evidence.id],
          bindings: [{ ...binding, transform: quotation ? "bounded_quote" : "identity" }] });
        commentaryBindings.push({ ...binding, transform: "recommendation" });
      }
      proof.references = proposal.references.map((item) => ({ ...item }));
      if (proposal.commentary) {
        const commentary = boundedText(proposal.commentary);
        proof.commentary = true;
        claims.push({ id: "v2-commentary", statement: commentary, kind: "inference",
          evidenceIds: [...selected.keys()], bindings: commentaryBindings });
        parts.unshift(escapeMarkdown(commentary));
      }
      return { text: parts.join("\n\n"), evidence: [...selected.values()], claims, proof };
    }
  }
}

/** Tell the model which references are eligible for cards, without creating a
 * second candidate store or accepting a model-authored title/URL/price/image. */
export function agentV2CandidateReferences(evidence: readonly Evidence[], effective?: EffectiveIntent): { evidenceId: string; title: string }[] {
  return evidence.flatMap((item) => {
    try { const card = placeCard(item, effective); return [{ evidenceId: card.evidenceId, title: card.title }]; }
    catch (error) { if (error instanceof AgentV2ReplyError) return []; throw error; }
  });
}
function placeCard(evidence: Evidence, effective?: EffectiveIntent): PublicPlaceCard {
  assertEvidence(evidence, effective);
  const facts = evidence.facts, observation = evidence.observation;
  if (observation?.predicate !== "place_description" || observation.state !== "current" ||
      !/^place:[^:]+:.+$/u.test(observation.subjectKey) || facts.sourcePrecision !== "place-description" ||
      typeof facts.sourceTitle !== "string" || typeof facts.sourceExcerpt !== "string" || typeof facts.sourceUrl !== "string" ||
      effective && !evidence.intentDependency || !evidence.references.some((ref) => ref.sourceType === "external-source" &&
        ref.sourceRef === facts.sourceUrl && ref.freshness === "current")) throw new AgentV2ReplyError("ineligible_evidence");
  const sourceUrl = publicPlaceSourceUrl(facts.sourceUrl);
  if (!sourceUrl) throw new AgentV2ReplyError("invalid_field");
  const title = boundedText(facts.sourceTitle).trim(), raw = boundedText(facts.sourceExcerpt).trim();
  // A bounded source excerpt, not a generated description or a full fetched page.
  const description = raw.slice(0, 400).trimEnd();
  try {
    return parsePublicPlacePresentation({ version: publicPlacePresentationVersion, cards: [{
      evidenceId: evidence.id, placeRef: observation.subjectKey, title, description, sourceUrl,
    }] }).cards[0]!;
  } catch { throw new AgentV2ReplyError("invalid_field"); }
}

/** Expose only factual fields that this publisher knows how to display. */
export function publicReplyField(field: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/u.test(field) &&
    !/(?:token|secret|password|credential|authorization|cookie|latitude|longitude|coordinates?|reasoning|signature|owner|principal|api_?key)/iu.test(field) &&
    !["constructor", "prototype", "__proto__"].includes(field) && !/(?:url|uri|link)$/iu.test(field);
}
function assertEvidence(evidence: Evidence, effective?: EffectiveIntent): void {
  const observation = evidence.observation;
  if (!["deterministic_fact", "derived_value"].includes(evidence.knowledgeKind) || !evidence.references.length ||
      evidence.references.some(({ freshness, sourceType }) => freshness === "unknown" || sourceType === "model") ||
      observation && (observation.applicability !== "applicable" || observation.retention === "prohibited" ||
        observation.state && observation.state !== "current") ||
      evidence.intentDependency && (!effective || evidence.intentDependency.intentRevision !== effective.intentRevision ||
        evidence.intentDependency.fingerprint !== effective.fingerprint)) throw new AgentV2ReplyError("ineligible_evidence");
}
function knownCondition(intent: EffectiveIntent | undefined, target: ReplyQuestion): boolean {
  if (!intent) return false;
  if (target === "goal" && intent.activeBaseGoal) return true;
  if (target === "party_size" && intent.activeBaseParty && intent.activeBaseParty.authority !== "assumption") return true;
  return intent.activeBaseFacts.some((fact) => fact.target === target && fact.authority === "persisted_user") ||
    intent.actualConversationFacts.some((fact) => fact.target === target && fact.value.kind !== "unknown" &&
      ["conversation", "trip"].includes(fact.scope.type));
}
function factText(value: unknown): string {
  if (typeof value === "string") return boundedText(value);
  if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return boundedText(value.join("、"));
  throw new AgentV2ReplyError("invalid_field");
}
function boundedText(value: string): string {
  if (!value.trim() || value.length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ||
      /<\s*\/?\s*(?:thinking|analysis|reasoning|think)(?:\s|>|\/)/iu.test(value)) throw new AgentV2ReplyError("unsafe_content");
  return value;
}
function escapeMarkdown(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|]/gu, "\\$&");
}
function sourceLink(evidence: Evidence): string {
  const reference = evidence.references.find(({ sourceType }) => sourceType === "external-source");
  if (!reference) return "";
  try {
    const url = new URL(reference.sourceRef);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        [...url.searchParams.keys()].some((key) => !publicReplyField(key))) return "";
    const destination = url.href.replaceAll("(", "%28").replaceAll(")", "%29").replaceAll(">", "%3E");
    return `[出典](${destination})`;
  } catch { return ""; }
}
