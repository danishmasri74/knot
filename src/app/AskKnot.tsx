import { AiProposalPreview } from "./AiProposalPreview";
import { Mascot } from "./Mascot";
import { AskSuggestion } from "./AskSuggestion";
import { AiStarters } from "./AiStarters";
import { useCallback } from "react";
import { topicIndex } from "../services/workspace-topic";
import {
  editIntent,
  webIntent,
  resolveSourceMode,
  outgoingSourceHistory,
  exchangeHistory,
  type SourceMode,
} from "../services/ai-source-scope";
import {
  AI_ABILITIES_CHANGED,
  AI_MODELS_CHANGED,
  AI_TOOL_MODES,
  MAX_IMAGES,
  MAX_SEARCHES,
  WEB_SEARCH_CHANGED,
  getWebSearchEnabled,
  automaticAiTools,
  getAiAbilities,
  getAiEnabled,
  getWorkspaceSearchEnabled,
  WORKSPACE_SEARCH_CHANGED,
  type AiAbilities,
  type AiTool,
} from "../services/ai-preferences";
import { recordAiOutcome } from "../services/ai-diagnostics";
import {
  deleteChatRecord,
  loadChatRecords,
  saveChatRecord,
  type ChatRecord,
} from "../services/ai-chats";
import {
  WebSourceCoordinator,
  detectWebUrls,
  normalizeWebUrl,
} from "../services/web-sources";
import { WEB_LIMITS, type WebAttempt } from "../services/web-source-types";
import { passageUrl } from "../services/text-fragment";
import {
  linksNeedingExcerpts,
  readExcerpt,
  withExcerpts,
} from "../services/web-search-excerpts";
import { citedSentence, claimsFor } from "../services/cited-sentence";
import { noteImageRefs, noteImageTexts } from "../services/note-image-text";
import {
  composeAiContext,
  retainedWebAttempts,
} from "../services/ai-context-composer";
import { WebSourceList, WebCoverage } from "./WebSourceList";
import { AttachmentImage, ContextAttachments } from "./ContextAttachments";
import { SentAttachments } from "./SentAttachments";
import {
  sentAttachments,
  type SentAttachment,
} from "../services/sent-attachments";
import { Popover } from "./Collections";
import {
  cardActions,
  cardRequestContext,
  qualifiedActions,
  type CardAction,
} from "../features/editor/blocksuite/card-suggestions";
import { AiBlocksPreview } from "./AiBlockPreview";
import { aiBlockText } from "../features/editor/blocksuite/ai-content";
import { usesNoteSources } from "../services/ai-source-scope";
import { type Passage } from "./PassagePicker";
import type { AiPdfSource } from "../services/pdf-input";
import {
  linkCitations,
  readCitationSources,
  withCitationSources,
} from "../services/ai-citations";
import type { LinkCitation } from "../services/web-source-types";
import { prepareAiImage } from "../services/ai-image";
import {
  aiModelName,
  visibleAiModels,
  automaticAiModel,
  initialAiModel,
  saveAiModelChoice,
} from "../services/ai-preferences";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ShellIcon } from "./ShellIcon";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { EditorSession } from "../features/editor/blocksuite/adapter";
import { youtubeCards } from "../features/editor/blocksuite/youtube-toolbar";
import {
  formatTimestamp,
  savedTranscripts,
  type VideoLocation,
} from "../services/youtube-transcript";
import {
  addAiMessageCard,
  applyAiProposal,
  captureAiContext,
  captureCardContext,
  structuredAiBlocks,
  validateProposal,
  type AiContext,
  type AiProposal,
} from "../features/editor/blocksuite/ai";
import { quizLines } from "../services/ai-quiz";
import { uncoveredPassages } from "../services/ai-atomize";
import { savedSearchText } from "../features/editor/blocksuite/search";
import {
  attachments,
  repository,
  type KnowledgeObject,
} from "../services/workspace";

type Turn = {
  evidenceId?: string;
  attemptId?: string;
  autoModel?: string;
  elapsedSeconds?: number;
  request?: {
    /** "auto" lets Knot answer or propose one edit with the offered tools. */
    mode: "auto" | "ask" | "rewrite" | "insert" | "canvas";
    context: string;
    /** Text sent to the model when it differs from the message shown. */
    message?: string;
    /** Workspace searches Knot ran for this message, with their evidence. */
    searches?: { callId: string; query: string; evidence: string }[];
    /** Web searches OpenAI ran for this message, and the links it cited. */
    webSearches?: number;
    links?: LinkCitation[];
    /** Names of the images Knot looked at (the pixels are never stored). */
    imagesViewed?: string[];
    sourceMode?: SourceMode;
    pdfSource?: AiPdfSource;
    image?: { key: string; name: string };
    /** What the user sent with the message, shown as chips above it. */
    attachments?: SentAttachment[];
  };
  role: "user" | "assistant";
  content: string;
  failed?: boolean;
  proposal?: AiProposal;
  context?: AiContext;
  mode?: "rewrite" | "insert" | "canvas" | "note" | "quiz";
  /** What an applied proposal created (a note, quiz or the first canvas
   * card): its first block, for the Open button. */
  createdNote?: { block: string; text: string };
  /** Break this into ideas: the canvas card these cards replace. */
  replaces?: string;
  /** Source passages the replacement cards don't cover (kept on Apply). */
  uncovered?: number;
  /** While streaming: the model is preparing a proposal (not persisted). */
  preparing?: boolean;
  /** After a web-search answer: capturing cited pages for passages (not persisted). */
  findingExcerpts?: boolean;
  /** While streaming: what Knot is doing, e.g. "Searching the web" (not persisted). */
  activity?: string;
  status?: "applied" | "dismissed";
  undo?: () => void;
  cost?: AiCost;
};
/** What OpenAI reported for one request, priced by Rust (`diagnostics.rs`). */
type AiCost = {
  usd: number | null;
  input: number | null;
  cached: number | null;
  output: number | null;
  reasoning: number | null;
  tier: string | null;
  pricing: string;
  /** Hosted web searches, charged per search on top of tokens. */
  web_searches?: number;
};
/** Everything this chat has cost, including retries and replaced answers. */
type Spent = { usd: number; priced: number; unpriced: number };
type Chat = {
  id: string;
  documentId: string;
  title: string;
  updated: number;
  turns: Turn[];
  evidence?: Record<string, NonNullable<Turn["request"]>>;
  spent?: Spent;
  /** This chat's abilities when they differ from the Settings defaults. */
  abilities?: AiAbilities;
};
/**
 * Opens a website through Knot's link router (installWebLinkRouter), which
 * applies Settings → Web links: Knot's browser or the default browser.
 */
function openWebLink(url: string): Promise<void> {
  window.open(url, "_blank", "noopener");
  return Promise.resolve();
}
function hydrateChat(record: ChatRecord): Chat {
  const chat = record as unknown as Chat;
  return {
    ...chat,
    turns: chat.turns.map((turn) =>
      turn.evidenceId && chat.evidence?.[turn.evidenceId]
        ? { ...turn, request: chat.evidence[turn.evidenceId] }
        : turn,
    ),
  };
}
function serializeChat(chat: Chat): string {
  const evidence: NonNullable<Chat["evidence"]> = {};
  const storedTurns = chat.turns.map(
    ({ context, undo, preparing, activity, findingExcerpts, ...turn }) => {
      void context;
      void undo;
      void preparing;
      void activity;
      void findingExcerpts;
      if (turn.request?.sourceMode === "workspace" && turn.attemptId) {
        evidence[turn.attemptId] = turn.request;
        return { ...turn, evidenceId: turn.attemptId, request: undefined };
      }
      return turn;
    },
  );
  return JSON.stringify({ ...chat, evidence, turns: storedTurns });
}
const noSpend: Spent = { usd: 0, priced: 0, unpriced: 0 };
function addSpend(spent: Spent, cost: AiCost): Spent {
  return cost.usd === null
    ? { ...spent, unpriced: spent.unpriced + 1 }
    : { ...spent, usd: spent.usd + cost.usd, priced: spent.priced + 1 };
}
/** Readable USD for small API amounts: two significant digits below a cent. */
function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "< $0.0001";
  if (usd < 0.01) return `$${usd.toPrecision(2)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
const tokenCount = (n: number | null) =>
  n === null ? "unknown" : n.toLocaleString();
function costDetail(cost: AiCost): string {
  const usage = `${tokenCount(cost.input)} input tokens (${tokenCount(cost.cached)} cached) · ${tokenCount(cost.output)} output tokens (${tokenCount(cost.reasoning)} reasoning)`;
  if (cost.usd === null) {
    const tier =
      cost.tier && !["default", "standard"].includes(cost.tier)
        ? ` (${cost.tier} service tier)`
        : "";
    return `Cost unknown: the usage OpenAI reported for this request can't be priced exactly${tier}. ${usage}. Your OpenAI usage page shows the billed amount.`;
  }
  const searches = cost.web_searches
    ? ` Includes ${cost.web_searches} web search${cost.web_searches === 1 ? "" : "es"} at $0.01 each.`
    : "";
  return `Estimated from OpenAI's published standard prices and the usage OpenAI reported. ${usage}.${searches} Your OpenAI bill is the final amount.`;
}
function spentDetail(spent: Spent): string {
  const unpriced = spent.unpriced
    ? ` ${spent.unpriced} request${spent.unpriced === 1 ? "" : "s"} couldn't be priced and ${spent.unpriced === 1 ? "isn't" : "aren't"} included.`
    : "";
  return `Estimated total for every request in this chat that OpenAI reported usage for, including retries and replaced answers.${unpriced} Stopped requests report no usage and aren't included. Your OpenAI bill is the final amount.`;
}
type AskKnotProps = Omit<
  Parameters<typeof AskKnotPanel>[0],
  "initialChats" | "initialError"
>;
/** Loads the workspace's saved chats before the panel's state starts. */

export function AskKnot(props: AskKnotProps) {
  const [loaded, setLoaded] = useState<{ chats: Chat[]; error: string }>();
  const { workspace } = props;
  useEffect(() => {
    let current = true;
    loadChatRecords(workspace)
      .then(({ chats, error }) => {
        if (current) setLoaded({ chats: chats.map(hydrateChat), error });
      })
      .catch(() => {
        if (current)
          setLoaded({
            chats: [],
            error:
              "Saved chats could not be loaded. Existing saved data has been kept.",
          });
      });
    return () => {
      current = false;
    };
  }, [workspace]);
  if (!loaded)
    return (
      <section
        className="ask-knot"
        aria-label="Ask Knot chat"
        aria-busy="true"
      />
    );
  return (
    <AskKnotPanel
      {...props}
      initialChats={loaded.chats}
      initialError={loaded.error}
    />
  );
}
function AskKnotPanel({
  initialChats,
  initialError,
  workspace,
  documentId,
  initial,
  suggestion,
  onSuggestionHandled,
  onBusy,
  getSession,
  onClose,
  onSource,
}: {
  workspace: string;
  documentId: string;
  initial: AiContext | null;
  suggestion: { context: AiContext; action: CardAction } | null;
  onSuggestionHandled: () => void;
  onBusy: (value: boolean) => void;
  getSession: () => EditorSession | null;
  onClose: () => void;
  initialChats: Chat[];
  initialError: string;
  onSource: (
    document: string,
    block: string,
    text: string,
    pdf?: import("../features/editor/blocksuite/pdf-highlights").PdfLocation,
    video?: VideoLocation,
    image?: import("../services/topic-types").ImageLocation,
  ) => Promise<void>;
}) {
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [chatId, setChatId] = useState(() => {
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(`knot.ai.active-chat.v1:${workspace}`);
    } catch {
      /* Optional preference. */
    }
    return (
      previous ??
      chats.find((chat) => chat.documentId === documentId)?.id ??
      chats[0]?.id ??
      crypto.randomUUID()
    );
  });
  useEffect(() => {
    try {
      localStorage.setItem(`knot.ai.active-chat.v1:${workspace}`, chatId);
    } catch {
      /* Keep chat usable. */
    }
  }, [workspace, chatId]);
  const chatIdRef = useRef(chatId);
  const chatDocumentId = useRef(
    chats.find((chat) => chat.id === chatId)?.documentId ?? documentId,
  );
  const [turns, setTurns] = useState<Turn[]>(
    () => chats.find((c) => c.id === chatId)?.turns ?? [],
  );
  const [spent, setSpent] = useState<Spent>(
    () => chats.find((c) => c.id === chatId)?.spent ?? noSpend,
  );
  const spentRef = useRef(spent);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editedText, setEditedText] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  /** The reply last saved with "Add reply as one card", and that card. */
  const [cardAdded, setCardAdded] = useState<{
    index: number;
    document: string;
    block: string;
    text: string;
  } | null>(null);
  const [saveError, setSaveError] = useState(initialError);
  const turnsRef = useRef(turns);
  const [context, setContext] = useState(initial);
  const sourceChoicesChanged = useRef(false);
  const [sourceScope, setSourceScope] = useState<
    "auto" | "workspace" | "current" | "none"
  >("auto");
  useEffect(() => {
    if (initial) setContext(initial);
  }, [initial]);
  const [prompt, setPrompt] = useState(() => {
    try {
      return localStorage.getItem(`knot.ai.draft.v1:${workspace}`) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`knot.ai.draft.v1:${workspace}`, prompt);
    } catch {
      /* Keep the live draft usable. */
    }
  }, [workspace, prompt]);
  const [webSources, setWebSources] = useState<WebAttempt[]>(() =>
    retainedWebAttempts(turns.at(-1)?.request?.context),
  );
  const webSourcesRef = useRef(webSources);
  const excludedUrls = useRef(new Set<string>());
  const sourceCoordinator = useRef(new WebSourceCoordinator());
  // Captures the pages a web-search answer cited, to find their passages.
  const excerptCoordinator = useRef(new WebSourceCoordinator());
  const excerptRun = useRef<Promise<void>>();
  function findExcerpts(turn: Turn) {
    const urls = linksNeedingExcerpts(turn.request?.links ?? []).slice(
      0,
      WEB_LIMITS.urls,
    );
    if (!urls.length || !mounted.current) return;
    const chat = chatIdRef.current;
    const attempts = new Map<string, WebAttempt>();
    turn.findingExcerpts = true;
    update([...turnsRef.current]);
    const current = () =>
      mounted.current &&
      chatIdRef.current === chat &&
      turnsRef.current.includes(turn);
    excerptRun.current = excerptCoordinator.current
      .capture(
        `${workspace}/${chat}/excerpts`,
        urls.map((url) => ({
          id: crypto.randomUUID(),
          url,
          state: "queued" as const,
        })),
        (attempt) => attempts.set(attempt.id, attempt),
      )
      .catch(() => {})
      .then(() => {
        turn.findingExcerpts = false;
        if (!current() || !turn.request) return;
        // Stopped captures (a new answer, pasted sources) stay plain links.
        const done = [...attempts.values()].filter(
          (a) => a.state !== "cancelled",
        );
        const finished = new Set(done.map((a) => a.url));
        const links = turn.request.links ?? [];
        const enriched = new Map(
          withExcerpts(
            turn.content,
            links.filter((l) => finished.has(l.url)),
            done,
          ).map((l) => [l.url, l]),
        );
        turn.request.links = links.map((l) => enriched.get(l.url) ?? l);
        update([...turnsRef.current]);
      });
  }

  function updateWebSources(value: WebAttempt[]) {
    webSourcesRef.current = value;
    setWebSources(value);
  }
  function invalidateWebProposals() {
    for (const turn of turnsRef.current)
      if (
        turn.proposal &&
        !turn.status &&
        retainedWebAttempts(turn.request?.context).length
      )
        turn.context = undefined;
    setTurns([...turnsRef.current]);
  }
  function addWebUrls(urls: string[]) {
    const fresh = urls.filter(
      (url) =>
        !excludedUrls.current.has(url) &&
        !webSourcesRef.current.some((s) => s.url === url),
    );
    if (!fresh.length) return;
    if (fresh.length + webSourcesRef.current.length > WEB_LIMITS.urls) {
      setError(
        `Use at most ${WEB_LIMITS.urls} website URLs. Remove sources before adding more.`,
      );
      return;
    }
    invalidateWebProposals();
    updateWebSources([
      ...webSourcesRef.current,
      ...fresh.map((url) => ({
        id: crypto.randomUUID(),
        url,
        state: "queued" as const,
      })),
    ]);
  }
  useEffect(() => {
    const urls = detectWebUrls(prompt);
    for (const url of excludedUrls.current)
      if (!urls.includes(url)) excludedUrls.current.delete(url);
    addWebUrls(urls);
  }, [prompt]);
  async function captureWebSources(attempts: WebAttempt[]) {
    // Pasted sources go first: stop finding excerpts (one native batch at a
    // time) and wait for it to release the fetcher.
    excerptCoordinator.current.cancel();
    await excerptRun.current;
    await sourceCoordinator.current.capture(
      `${workspace}/${chatIdRef.current}`,
      attempts,
      (attempt) => {
        if (!mounted.current) return;
        updateWebSources(
          webSourcesRef.current.map((previous) =>
            previous.id === attempt.id
              ? attempt.state === "cancelled" &&
                ["ready", "partial", "failed"].includes(previous.state)
                ? previous
                : attempt
              : previous,
          ),
        );
      },
    );
  }
  const [defaultAbilities, setDefaultAbilities] = useState(getAiAbilities);
  const [chatAbilities, setChatAbilities] = useState<AiAbilities | undefined>(
    () => chats.find((c) => c.id === chatId)?.abilities,
  );
  const chatAbilitiesRef = useRef(chatAbilities);
  const abilities = chatAbilities ?? defaultAbilities;
  useEffect(() => {
    const changed = () => setDefaultAbilities(getAiAbilities());
    window.addEventListener(AI_ABILITIES_CHANGED, changed);
    return () => window.removeEventListener(AI_ABILITIES_CHANGED, changed);
  }, []);
  /** Whether Knot may search the workspace for this chat's next message. */
  const [webSearch, setWebSearch] = useState(getWebSearchEnabled);
  useEffect(() => {
    const changed = () => setWebSearch(getWebSearchEnabled());
    window.addEventListener(WEB_SEARCH_CHANGED, changed);
    return () => window.removeEventListener(WEB_SEARCH_CHANGED, changed);
  }, []);
  function searchAvailable() {
    return (
      getAiEnabled() &&
      getWorkspaceSearchEnabled() &&
      (chatAbilitiesRef.current ?? getAiAbilities()).searchWorkspace
    );
  }
  /** Abilities Settings turns off for every chat. */
  function settingOff(key: keyof AiAbilities) {
    return key === "searchWorkspace"
      ? !automaticSearch
      : key === "searchWeb"
        ? !webSearch
        : false;
  }
  function changeAbilities(next: AiAbilities | undefined) {
    chatAbilitiesRef.current = next;
    setChatAbilities(next);
    if (turnsRef.current.length) update([...turnsRef.current]);
  }
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const providerModels = useRef<string[]>([]);
  function filterModels(available: string[]) {
    providerModels.current = available;
    return visibleAiModels(available);
  }
  useEffect(() => {
    const changed = () => {
      const next = visibleAiModels(providerModels.current);
      setModels(next);
      setModel(initialAiModel(next));
    };
    window.addEventListener(AI_MODELS_CHANGED, changed);
    return () => window.removeEventListener(AI_MODELS_CHANGED, changed);
  }, []);
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [passages, setPassages] = useState<Passage[]>([]);
  const [added, setAdded] = useState<KnowledgeObject[]>([]);
  const [image, setImage] = useState<{ key: string; name: string } | undefined>(
    () => {
      try {
        const saved = JSON.parse(
          localStorage.getItem(`knot.ai.draft-image.v1:${workspace}`) ?? "null",
        );
        return saved &&
          typeof saved.key === "string" &&
          typeof saved.name === "string"
          ? saved
          : undefined;
      } catch {
        return undefined;
      }
    },
  );
  useEffect(() => {
    try {
      if (image)
        localStorage.setItem(
          `knot.ai.draft-image.v1:${workspace}`,
          JSON.stringify(image),
        );
      else localStorage.removeItem(`knot.ai.draft-image.v1:${workspace}`);
    } catch {
      /* Attachment remains available in this session. */
    }
  }, [workspace, image]);
  const [uploadScope, setUploadScope] = useState<string>();
  const uploadId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  async function attachFile(file: File) {
    if (busy || attaching) return;
    const upload = ++uploadId.current;
    sourceChoicesChanged.current = true;
    setImage(undefined);
    setUploadScope(file.name || "Image attachment");
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) {
      setError("Choose an image smaller than 20 MB.");
      return;
    }
    setAttaching(true);
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      if (upload !== uploadId.current || !mounted.current) return;
      const key = await attachments.put(
        documentId,
        crypto.randomUUID(),
        bytes,
        file.name,
        file.type,
      );
      await prepareAiImage(key);
      if (upload !== uploadId.current || !mounted.current) return;
      setUploadScope(undefined);
      setImage({ key, name: file.name || "Pasted image" });
      setError("");
    } catch (error) {
      if (upload === uploadId.current && mounted.current)
        setError(String(error));
    } finally {
      if (upload === uploadId.current && mounted.current) setAttaching(false);
    }
  }
  const [automaticSearch, setAutomaticSearch] = useState(
    getWorkspaceSearchEnabled,
  );
  const [retrievalStatus, setRetrievalStatus] = useState("");
  const retrievalAbort = useRef<AbortController>();
  const automaticRequest = useRef(false);
  const lastRequest = turns.filter((t) => t.role === "user").at(-1)?.request;
  const lastScope = lastRequest?.sourceMode;
  function resolveScope(
    input: string,
    action: NonNullable<Turn["request"]>["mode"] = "auto",
  ): SourceMode {
    return resolveSourceMode({
      scope: sourceScope,
      mode: action,
      prompt: input,
      automatic: getAiEnabled() && getWorkspaceSearchEnabled(),
      selected: !!(
        context?.pdf ||
        context?.sourceIntent === "explicit" ||
        (context?.sourceIntent !== "ambient" && context?.label === "Selection")
      ),
      attached: !!(
        image ||
        attaching ||
        uploadScope ||
        added.length ||
        passages.length ||
        webSourcesRef.current.length ||
        detectWebUrls(input).length
      ),
      active: !!getSession(),
      inherited: sourceScope === "auto" ? lastScope : undefined,
    });
  }
  const resolvedScope = resolveScope(prompt);
  useEffect(() => {
    const changed = () => {
      setAutomaticSearch(getWorkspaceSearchEnabled());
      if (!getWorkspaceSearchEnabled() && automaticRequest.current) {
        retrievalAbort.current?.abort();
        const id = request.current;
        request.current = null;
        if (id) void invoke("ai_cancel", { id: inflight.current ?? id });
        const last = turnsRef.current.at(-1);
        if (last?.role === "assistant" && last.attemptId === id) {
          last.failed = true;
          last.content ||= "Stopped because workspace search was disabled.";
          update([...turnsRef.current]);
        }
        setBusy(false);
        setRetrievalStatus("");
      }
    };
    window.addEventListener(WORKSPACE_SEARCH_CHANGED, changed);
    return () => {
      retrievalAbort.current?.abort();
      window.removeEventListener(WORKSPACE_SEARCH_CHANGED, changed);
    };
  }, []);
  void automaticSearch;
  const includeSources =
    resolvedScope !== "workspace" &&
    resolvedScope !== "none" &&
    resolvedScope !== "explicit" &&
    usesNoteSources(
      sourceScope,
      "ask",
      prompt,
      context?.label === "Selection" || context?.label === "Focused note",
      !!(added.length || passages.length || context?.pdf),
    );
  const imageSources = getSession()?.imageSources() ?? [];
  const previousSelection = useRef<string>();
  useEffect(() => {
    const key = context?.selectionKey;
    if (context?.sourceIntent === "ambient") return;
    if (key === previousSelection.current) return;
    const previous = previousSelection.current;
    previousSelection.current = key;
    if (key && key !== "[[],[],[]]") setSourceScope("current");
    else if (previous && previous !== "[[],[],[]]") setSourceScope("none");
  }, [context?.selectionKey]);
  const previousSelectionImage = useRef<string>();
  useEffect(() => {
    const key = context?.selectedImageKey;
    const previous = previousSelectionImage.current;
    previousSelectionImage.current = key;
    if (key) {
      const selected = getSession()
        ?.imageSources()
        .find((item) => item.key === key);
      if (selected) setImage(selected);
    } else if (previous) {
      setImage((current) => (current?.key === previous ? undefined : current));
    }
  }, [context?.selectedImageKey]);
  const request = useRef<string | null>(null);
  /** The request in flight: the turn's ID, or a later round after a search. */
  const inflight = useRef<string | null>(null);
  const requestStartedAt = useRef(0);
  const mounted = useRef(true);
  const messages = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const streamTimer = useRef<ReturnType<typeof setTimeout>>();
  function clearStreamTimer() {
    clearTimeout(streamTimer.current);
    streamTimer.current = undefined;
  }
  function update(value: Turn[]) {
    turnsRef.current = value;
    const chat: Chat = {
      id: chatIdRef.current,
      documentId: chatDocumentId.current,
      title:
        value.find((t) => t.role === "user")?.content.slice(0, 90) ||
        "New chat",
      updated: Date.now(),
      turns: value,
      spent: spentRef.current,
      abilities: chatAbilitiesRef.current,
    };
    if (value.length)
      saveChatRecord(workspace, chat.id, serializeChat(chat)).then(
        () => {
          if (mounted.current) setSaveError("");
        },
        () => {
          if (mounted.current)
            setSaveError(
              "This chat could not be saved to the workspace. Try again.",
            );
        },
      );
    if (mounted.current && value.length)
      setChats((previous) => [
        chat,
        ...previous.filter((c) => c.id !== chat.id),
      ]);
    if (mounted.current) {
      setTurns(value);
      setSpent(spentRef.current);
    }
  }
  /** Records a request's cost on its answer and in the chat it was sent from. */
  function recordCost(draft: Turn, cost: AiCost, chat: string) {
    if (!mounted.current || chatIdRef.current !== chat) return;
    // A message that searched made several requests; its cost is their sum.
    draft.cost = draft.cost ? addCost(draft.cost, cost) : cost;
    spentRef.current = addSpend(spentRef.current, cost);
    update([...turnsRef.current]);
  }
  function openChat(chat?: Chat) {
    const active = request.current;
    request.current = null;
    clearStreamTimer();
    if (active) void invoke("ai_cancel", { id: inflight.current ?? active });
    setBusy(false);
    sourceCoordinator.current.cancel();
    excerptCoordinator.current.cancel();
    excludedUrls.current.clear();
    updateWebSources(retainedWebAttempts(chat?.turns.at(-1)?.request?.context));
    followLatest.current = true;
    const id = chat?.id ?? crypto.randomUUID();
    chatIdRef.current = id;
    chatDocumentId.current = chat?.documentId ?? documentId;
    setChatId(id);
    turnsRef.current = chat?.turns ?? [];
    setTurns(turnsRef.current);
    spentRef.current = chat?.spent ?? noSpend;
    setSpent(spentRef.current);
    setPrompt("");
    setEditing(null);
    setError("");
    setCopied(null);
    setCardAdded(null);
    uploadId.current++;
    setUploadScope(undefined);
    setAttaching(false);
    sourceChoicesChanged.current = false;
    setAdded([]);
    setPassages([]);
    setImage(chat?.turns.at(-1)?.request?.image);
    chatAbilitiesRef.current = chat?.abilities;
    setChatAbilities(chat?.abilities);
    setHistoryOpen(false);
  }
  async function copyTurn(turn: Turn, index: number) {
    const text = turn.proposal
      ? turn.mode === "rewrite"
        ? turn.proposal.replacements.join("")
        : [
            ...(turn.proposal.mindmap ?? []).map((node) =>
              node.parent < 0
                ? node.text
                : `${turn.proposal!.mindmap![node.parent].text} → ${node.text}`,
            ),
            ...turn.proposal.blocks.map(aiBlockText),
            ...quizLines(turn.proposal.questions),
          ].join("\n")
      : turn.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
    } catch {
      setError("Could not copy this message. Please try again.");
    }
  }
  /** Opens what a sent message's chip points at. */
  function openAttachment(item: SentAttachment) {
    setError("");
    const opened = item.video
      ? onSource(
          item.video.documentId,
          item.video.blockId,
          "",
          undefined,
          item.video,
        )
      : item.url
        ? openWebLink(item.url)
        : item.document
          ? onSource(
              item.document,
              item.block ?? "",
              item.text ?? "",
              item.pdf && {
                key: item.pdf.key,
                name: item.label,
                documentId: item.document,
                page: item.pdf.page ?? 1,
                rects: [],
              },
            )
          : Promise.resolve();
    void Promise.resolve(opened).catch((e) => setError(String(e)));
  }
  function addTurnAsCard(turn: Turn, index: number) {
    try {
      const session = getSession();
      if (!session)
        throw new Error("Open a notebook to add this message as a card.");
      const text =
        turn.mode === "rewrite" && turn.proposal
          ? turn.proposal.replacements.join("")
          : turn.content;
      const blocks =
        turn.proposal && turn.mode !== "rewrite"
          ? [
              ...(turn.proposal.mindmap ?? []).map((node) => ({
                type: "paragraph" as const,
                text:
                  node.parent < 0
                    ? node.text
                    : `${turn.proposal!.mindmap![node.parent].text} → ${node.text}`,
              })),
              ...turn.proposal.blocks,
              ...quizLines(turn.proposal.questions).map((line) => ({
                type: "paragraph" as const,
                text: line,
              })),
            ]
          : [{ type: "paragraph" as const, text }];
      const card = session.doc.getBlock(addAiMessageCard(session.doc, blocks))
        ?.model.children[0];
      setCardAdded({
        index,
        document: session.doc.id,
        block: card?.id ?? "",
        text: card?.text?.toString() ?? "",
      });
      setError("");
    } catch (error) {
      setError(String(error));
    }
  }
  const captureStarter = useCallback(() => {
    try {
      const session = getSession();
      if (!session || session.doc.id !== documentId) return null;
      return captureAiContext(
        session.editor,
        workspace,
        session.revealedNoteId,
      );
    } catch {
      return null;
    }
  }, [getSession, documentId, workspace]);
  function refresh(deliberate = false) {
    if (initial?.pdf && !initial.selectionKey) return;
    const s = getSession();
    if (s?.doc.id === documentId)
      setContext({
        ...captureAiContext(s.editor, workspace, s.revealedNoteId),
        ...(!deliberate ? { sourceIntent: "ambient" as const } : {}),
      });
  }
  useEffect(() => {
    mounted.current = true;
    void invoke<boolean>("ai_connected")
      .then(async (value) => {
        if (!mounted.current) return;
        setConnected(value);
        setSettings(!value);
        if (value) {
          const available = filterModels(await invoke<string[]>("ai_models"));
          if (mounted.current) {
            setModels(available);
            setModel(initialAiModel(available));
          }
        }
        if (mounted.current) setModelStatus("ready");
      })
      .catch((e) => {
        if (mounted.current) {
          setModelStatus("error");
          setError(String(e));
        }
      });
    return () => {
      mounted.current = false;
      uploadId.current++;
      sourceCoordinator.current.cancel();
      excerptCoordinator.current.cancel();
      clearStreamTimer();
      if (request.current) {
        const id = request.current;
        void invoke("ai_cancel", { id: inflight.current ?? id });
        request.current = null;
        const last = turnsRef.current.at(-1);
        if (
          last?.role === "assistant" &&
          last.attemptId === id &&
          last.failed
        ) {
          last.elapsedSeconds = responseElapsedSeconds(
            requestStartedAt.current,
          );
          last.content ||= "Stopped";
          update([...turnsRef.current]);
        }
      }
    };
    // Pane continuity preserves this instance during citation navigation.
  }, []);
  useEffect(() => {
    const s = getSession();
    let frame = 0;
    const capture = (event?: unknown) => {
      cancelAnimationFrame(frame);
      const deliberate = event instanceof Event && event.isTrusted;
      frame = requestAnimationFrame(() => refresh(deliberate));
    };
    const selectionSubscription =
      s?.editor.std?.selection?.slots.changed.on(capture);
    const canvasSubscription = s?.editor
      .querySelector?.("affine-edgeless-root")
      ?.gfx.selection.slots.updated.on(capture);
    s?.editor.addEventListener("pointerup", capture);
    s?.editor.addEventListener("keyup", capture);
    return () => {
      selectionSubscription?.dispose();
      canvasSubscription?.dispose();
      cancelAnimationFrame(frame);
      s?.editor.removeEventListener("pointerup", capture);
      s?.editor.removeEventListener("keyup", capture);
    };
  }, [workspace, documentId]);
  useLayoutEffect(() => {
    const scroller = messages.current;
    if (scroller && followLatest.current)
      scroller.scrollTop = scroller.scrollHeight;
  }, [turns, historyOpen]);
  async function connect() {
    setConnecting(true);
    setError("");
    try {
      const list = filterModels(
        await invoke<string[]>("ai_connect", { apiKey }),
      );
      setModelStatus("ready");
      setModels(list);
      setModel(initialAiModel(list));
      setConnected(true);
      setApiKey("");
      setEditingKey(false);
      setSettings(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  }
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  useEffect(() => {
    if (!suggestion || modelStatus === "loading") return;
    if (!connected && modelStatus === "ready") return;
    onSuggestionHandled();
    const s = getSession();
    const card = s?.doc.getBlock(suggestion.context.note ?? "")?.model;
    if (!s || s.doc !== suggestion.context.instance || !card) return;
    const current = captureCardContext(s.doc, workspace, card);
    if (
      !qualifiedActions(current.structure, current.document).includes(
        suggestion.action,
      )
    )
      return;
    if (busy || request.current) return;
    const input = cardActions[suggestion.action].prompt;
    setContext(current);
    setSourceScope("current");
    if (!connected || !model || !models.length) {
      setPrompt(input);
      setError("Connect an AI model to generate this suggestion.");
      return;
    }
    openChat();
    // The chat shows a short request; the full instruction is what's sent.
    void send(
      undefined,
      "Break this card into ideas",
      current,
      undefined,
      undefined,
      { message: input },
    );
  }, [suggestion, modelStatus, connected, model, models.length]);
  async function sendWorkspace(
    input: string,
    retryIndex?: number,
    edited?: string,
    generalMode?: SourceMode,
    /** Set for automatic messages: Knot may search instead of being given evidence. */
    auto?: { inPlace?: boolean; message?: string },
  ) {
    if (!input || busy || request.current || !connected) return;
    const id = crypto.randomUUID();
    automaticRequest.current = !generalMode;
    request.current = id;
    retrievalAbort.current?.abort();
    const abort = new AbortController();
    retrievalAbort.current = abort;
    setBusy(true);
    setError("");
    setRetrievalStatus("Searching workspace…");
    requestStartedAt.current = performance.now();
    let draft: Turn | undefined;
    try {
      const base =
        retryIndex === undefined
          ? turnsRef.current
          : turnsRef.current.slice(
              0,
              retryIndex -
                (turnsRef.current[retryIndex]?.role === "assistant" ? 1 : 0),
            );
      const previous = base
        .filter(
          (t) => t.role === "user" && t.request?.sourceMode === "workspace",
        )
        .at(-1)?.content;
      const query =
        previous &&
        /^(what|how|why|and|but|are|does|can)\b.*\b(it|its|they|their|them|that|those|drawbacks|disadvantages)\b/i.test(
          input,
        )
          ? `${previous.slice(0, 1500)}\n${input}`
          : input;
      const live = getSession()?.topicOverlay();
      const fingerprint = getSession()?.topicVersion();
      if (auto) setRetrievalStatus("");
      const evidence = generalMode
        ? {
            version: 1 as const,
            sourceMode: "workspace" as const,
            activation: "",
            coverage: { indexed: 0, total: 0, failed: 0, semantic: true },
            citationSources: [],
          }
        : await topicIndex().search(query, abort.signal, live);
      if (getSession()?.topicVersion() !== fingerprint)
        throw Error(
          "Notes changed during retrieval. Send again to search the current text.",
        );
      if (
        abort.signal.aborted ||
        request.current !== id ||
        !mounted.current ||
        (!generalMode && !getWorkspaceSearchEnabled())
      )
        return;
      const requestContext = JSON.stringify(
        generalMode
          ? { sourceMode: generalMode, citationSources: [] }
          : evidence,
      );
      const user: Turn = {
        attemptId: id,
        role: "user",
        content: input,
        request: {
          mode: auto ? "auto" : "ask",
          sourceMode: generalMode ?? "workspace",
          context: requestContext,
          message: auto?.message,
        },
      };
      draft = {
        attemptId: id,
        role: "assistant",
        content: "",
        failed: true,
        request: user.request,
      };
      if (retryIndex !== undefined && edited === undefined && !auto?.inPlace) {
        const branch = crypto.randomUUID();
        chatIdRef.current = branch;
        setChatId(branch);
        // A branch starts its own total; the original chat keeps its spend.
        spentRef.current = noSpend;
      }
      followLatest.current = true;
      update([...base.map((t) => ({ ...t })), user, draft]);
      setEditing(null);
      setHistoryOpen(false);
      if (retryIndex === undefined) setPrompt("");
      setRetrievalStatus(
        evidence.coverage.failed
          ? `Partial coverage: ${evidence.coverage.indexed} of ${evidence.coverage.total} sources indexed.`
          : !evidence.coverage.semantic
            ? "Keyword search only; semantic search is unavailable."
            : "",
      );
      if (auto) {
        const tools = automaticAiTools(abilities, {
          selection: false,
          note: false,
          canvas: false,
          editable: false,
          search: searchAvailable(),
          web: getAiEnabled() && getWebSearchEnabled() && wantsWeb(input, base),
        });
        const chosen =
          model === "auto"
            ? automaticAiModel(models, "ask", input, false, 0)
            : model;
        draft.autoModel = model === "auto" ? chosen : undefined;
        const result = await streamWithSearch({
          id,
          draft,
          request: user.request!,
          mode: "auto",
          tools,
          payload: {
            model: chosen,
            messages: [
              ...exchangeHistory(base),
              { role: "user", content: auto.message ?? input },
            ],
            context: requestContext,
          },
          sentFrom: chatIdRef.current,
        });
        if (!result || request.current !== id || !mounted.current) return;
      } else if (!generalMode && !evidence.citationSources.length) {
        draft.content = evidence.coverage.failed
          ? "I couldn’t find a supporting passage in the indexed content. Workspace coverage is incomplete."
          : "I couldn’t find a supporting passage in this workspace.";
      } else {
        const chosen =
          model === "auto"
            ? automaticAiModel(
                models,
                "ask",
                input,
                false,
                requestContext.length,
              )
            : model;
        draft.autoModel = model === "auto" ? chosen : undefined;
        const sentFrom = chatIdRef.current;
        const channel = new Channel<{ delta: string; cost?: AiCost }>();
        channel.onmessage = ({ delta, cost }) => {
          if (cost) return recordCost(draft!, cost, sentFrom);
          if (
            request.current !== id ||
            abort.signal.aborted ||
            !mounted.current
          )
            return;
          draft!.content += delta;
          streamTimer.current ??= setTimeout(() => {
            streamTimer.current = undefined;
            if (request.current === id) update([...turnsRef.current]);
          }, 80);
        };
        // Previous answers/excerpts never cross a request boundary. The bounded topic is used only for local retrieval.
        if (getSession()?.topicVersion() !== fingerprint)
          throw Error("Notes changed before transmission. Send again.");
        await invoke("ai_respond", {
          id,
          model: chosen,
          mode: "ask",
          messages: [{ role: "user", content: input }],
          context: requestContext,
          onEvent: channel,
        });
        if (request.current !== id || abort.signal.aborted || !mounted.current)
          return;
        recordAiOutcome(id, "answer_displayed");
      }
      draft.failed = false;
      draft.elapsedSeconds = responseElapsedSeconds(requestStartedAt.current);
      update([...turnsRef.current]);
    } catch (e) {
      if (request.current === id && mounted.current) {
        setError(String(e));
        if (draft) {
          draft.content ||= "Response interrupted. Try again.";
          update([...turnsRef.current]);
        }
      }
    } finally {
      if (request.current === id) {
        clearStreamTimer();
        request.current = null;
        automaticRequest.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  /**
   * Sends a request and streams its answer. When Knot calls search_workspace,
   * the search runs on this device and its results go back with the next
   * request, at most twice; the last round answers or proposes. Returns
   * undefined when the request was stopped or replaced.
   */
  async function streamWithSearch(r: {
    id: string;
    draft: Turn;
    request: NonNullable<Turn["request"]>;
    mode: NonNullable<Turn["request"]>["mode"];
    tools: AiTool[];
    payload: {
      model: string;
      messages: { role: string; content: string }[];
      context: string;
      image?: string;
      pdfInput?: string;
      link?: { parent: string; kind: string };
    };
    sentFrom: string;
    /** Images view_images may show, from the open note or canvas. */
    images?: { key: string; name: string }[];
  }): Promise<
    { output: string; toolCall?: AiTool; toolArguments: string } | undefined
  > {
    const searches: NonNullable<NonNullable<Turn["request"]>["searches"]> = [];
    let tools = r.tools;
    let attempt = r.id;
    const viewed: { callId: string; names: string[]; images: string[] }[] = [];
    const abort = new AbortController();
    if (tools.includes("search_workspace")) {
      retrievalAbort.current?.abort();
      retrievalAbort.current = abort;
      // Turning workspace search off stops this message.
      automaticRequest.current = true;
    }
    for (;;) {
      let output = "";
      let toolCall: AiTool | undefined;
      let callId = "";
      let toolArguments = "";
      let displayed = false;
      let cited: {
        url: string;
        title?: string;
        start?: number;
        end?: number;
      }[] = [];
      const channel = new Channel<{
        delta: string;
        cost?: AiCost;
        call?: string;
        call_id?: string;
        status?: string;
        citations?: typeof cited;
      }>();
      channel.onmessage = ({
        delta,
        cost,
        call,
        call_id,
        status,
        citations,
      }) => {
        if (cost) return recordCost(r.draft, cost, r.sentFrom);
        if (request.current !== r.id || !mounted.current) return;
        if (status === "web") {
          r.request.webSearches = (r.request.webSearches ?? 0) + 1;
          r.draft.activity = "Searching the web";
          update([...turnsRef.current]);
          return;
        }
        if (citations) {
          cited = [...cited, ...citations];
          return;
        }
        if (call) {
          if (!toolCall) {
            toolCall = call as AiTool;
            callId = call_id ?? "";
            if (call === "search_workspace")
              r.draft.activity = "Searching workspace";
            else if (call === "view_images")
              r.draft.activity = "Looking at images";
            else r.draft.preparing = true;
            update([...turnsRef.current]);
          }
          toolArguments += delta;
          return;
        }
        r.draft.activity = undefined;
        output += delta;
        if (r.mode === "ask" || r.mode === "auto") {
          r.draft.content = output;
          if (!displayed) {
            displayed = true;
            recordAiOutcome(r.id, "answer_displayed");
          }
          // Coalesce token bursts so parsing, rendering and localStorage writes
          // leave the main thread available for scrolling. The draft always
          // holds the latest text, including when stopped or unmounted.
          streamTimer.current ??= setTimeout(() => {
            streamTimer.current = undefined;
            if (request.current === r.id && mounted.current)
              update([...turnsRef.current]);
          }, 80);
        }
      };
      inflight.current = attempt;
      try {
        await invoke("ai_respond", {
          ...r.payload,
          id: attempt,
          link: attempt === r.id ? r.payload.link : undefined,
          // Without tools or searches an automatic request is an ordinary answer.
          mode:
            r.mode !== "auto"
              ? r.mode
              : tools.length || searches.length || viewed.length
                ? "auto"
                : "ask",
          tools: tools.length ? tools : undefined,
          searches: searches.length ? searches : undefined,
          viewed: viewed.length ? viewed : undefined,
          onEvent: channel,
        });
      } finally {
        if (inflight.current === attempt) inflight.current = null;
      }
      if (request.current !== r.id || !mounted.current) return;
      if (toolCall === "view_images") {
        // Prepared smaller than attachments: up to three go in one request.
        const chosen = (r.images ?? []).slice(0, MAX_IMAGES);
        const prepared = [];
        for (const image of chosen)
          prepared.push(
            await prepareAiImage(image.key, { side: 1600, area: 2500000 }),
          );
        if (request.current !== r.id || !mounted.current) return;
        if (!prepared.length || !callId)
          throw new Error("No images could be read. Please try again.");
        viewed.push({
          callId,
          names: chosen.map((image) => image.name.slice(0, 200)),
          images: prepared.map((image) => image.pixels),
        });
        r.request.imagesViewed = viewed[0].names;
        tools = tools.filter((tool) => tool !== "view_images");
        r.draft.content = "";
        attempt = crypto.randomUUID();
        continue;
      }
      if (toolCall !== "search_workspace") {
        r.draft.activity = undefined;
        if (cited.length) {
          // Web links become numbered sources after the note's and workspace's.
          const converted = linkCitations(
            output,
            cited,
            lastCitation(r.payload.context, [
              ...searches,
              {
                evidence: JSON.stringify({
                  citationSources: r.request.links ?? [],
                }),
              },
            ]),
          );
          output = converted.text;
          r.request.links = [...(r.request.links ?? []), ...converted.links];
          if (r.mode === "ask" || r.mode === "auto") r.draft.content = output;
          update([...turnsRef.current]);
          // Passages from the cited pages, captured on this device once the
          // answer is in place.
          const answered = r.draft;
          setTimeout(() => findExcerpts(answered), 0);
        }
        return { output, toolCall, toolArguments };
      }
      let query = "";
      try {
        query = String(
          (JSON.parse(toolArguments) as { query?: unknown }).query ?? "",
        )
          .trim()
          .slice(0, 2000);
      } catch {
        query = "";
      }
      if (!query || !callId)
        throw new Error("The search request was invalid. Please try again.");
      r.draft.activity = "Searching workspace";
      r.draft.content = "";
      update([...turnsRef.current]);
      setRetrievalStatus(`Searching workspace for “${query}”…`);
      const fingerprint = getSession()?.topicVersion();
      const found = await topicIndex().search(
        query,
        abort.signal,
        getSession()?.topicOverlay(),
      );
      if (getSession()?.topicVersion() !== fingerprint)
        throw Error(
          "Notes changed during retrieval. Send again to search the current text.",
        );
      if (
        abort.signal.aborted ||
        request.current !== r.id ||
        !mounted.current ||
        !getWorkspaceSearchEnabled()
      )
        return;
      // Excerpts continue the message's citation numbers.
      const offset = lastCitation(r.payload.context, searches);
      searches.push({
        callId,
        query,
        evidence: JSON.stringify({
          ...found,
          citationSources: found.citationSources.map((source, index) => ({
            ...source,
            citation: `[S${offset + index + 1}]`,
          })),
        }),
      });
      r.request.searches = [...searches];
      setRetrievalStatus(
        found.coverage.failed
          ? `Partial coverage: ${found.coverage.indexed} of ${found.coverage.total} sources indexed.`
          : !found.coverage.semantic
            ? "Keyword search only; semantic search is unavailable."
            : "",
      );
      if (searches.length >= MAX_SEARCHES)
        tools = tools.filter((tool) => tool !== "search_workspace");
      attempt = crypto.randomUUID();
    }
  }
  /** Explicitly turns an answer into a note addition or canvas cards. */
  function sendAnswerTo(turn: Turn, action: "insert" | "canvas") {
    void send(
      undefined,
      action === "insert"
        ? "Insert this answer into the note"
        : "Split this answer into canvas cards",
      undefined,
      undefined,
      action,
      {
        message: `${action === "insert" ? "Add the following answer to my note" : "Turn the following answer into canvas content"}. Keep its facts and do not add new ones.\n\n${turn.content}`,
      },
    );
  }
  async function send(
    retryIndex?: number,
    edited?: string,
    cardContext?: AiContext,
    starterContext?: AiContext,
    /** An explicit action; otherwise Knot answers or proposes on its own. */
    forced?: "ask" | "rewrite" | "insert" | "canvas",
    options?: {
      /** Replace the retried answer in this chat instead of branching. */
      inPlace?: boolean;
      /** Text to send instead of the message shown in the chat. */
      message?: string;
      /** Answer only: Knot may still search, but not propose an edit. */
      answerOnly?: boolean;
    },
  ) {
    const retry =
      retryIndex === undefined ? undefined : turnsRef.current[retryIndex];
    const retryUser =
      retryIndex === undefined
        ? undefined
        : turnsRef.current
            .slice(0, retryIndex + 1)
            .reverse()
            .find((t) => t.role === "user");
    const input = edited?.trim() ?? retryUser?.content ?? prompt.trim();
    const outgoing =
      options?.message ??
      (retryIndex !== undefined && edited === undefined
        ? retryUser?.request?.message
        : undefined) ??
      input;
    const action = cardContext
      ? "canvas"
      : (forced ?? retry?.request?.mode ?? "auto");
    const answers = action === "ask" || action === "auto";
    const s = getSession();
    if (attaching || (uploadScope && !image)) {
      setError(
        attaching
          ? "Wait for the image to finish preparing, or remove it."
          : "This attachment could not be read. Retry it or remove it before sending.",
      );
      return;
    }
    const resolved = starterContext
      ? "current"
      : retry && !retry.request?.sourceMode && sourceScope === "auto"
        ? "legacy"
        : resolveScope(input, action);
    if (answers && !s && (resolved === "none" || resolved === "legacy")) {
      await sendWorkspace(
        input,
        retryIndex,
        edited,
        resolved,
        action === "auto" ? (options ?? {}) : undefined,
      );
      return;
    }
    if (resolved === "workspace") {
      await sendWorkspace(input, retryIndex, edited);
      return;
    }
    if (!s || !input || busy || request.current || !connected) return;
    setError("");
    automaticRequest.current = false;
    const id = crypto.randomUUID();
    request.current = id;
    requestStartedAt.current = performance.now();
    setBusy(true);
    let draft: Turn | undefined;
    try {
      if (!retry) {
        // A selected website card has no text of its own: read its page
        // like a pasted URL, unless the user removed that source.
        const card =
          !starterContext && !cardContext && context?.label === "Selection"
            ? context.websiteUrl
            : undefined;
        const detected = [
          ...new Set([...detectWebUrls(input), ...(card ? [card] : [])]),
        ].filter((url) => !excludedUrls.current.has(url));
        if (
          new Set([...webSourcesRef.current.map((s) => s.url), ...detected])
            .size > WEB_LIMITS.urls
        )
          throw new Error(`Use at most ${WEB_LIMITS.urls} website URLs.`);
        addWebUrls(detected);
        const queued = webSourcesRef.current.filter(
          (source) => source.state === "queued",
        );
        if (queued.length) await captureWebSources(queued);
        if (request.current !== id || !mounted.current) return;
      }
      const current =
        starterContext ??
        cardContext ??
        (context?.pdf ||
        context?.label === "Selection" ||
        context?.ranges.length
          ? context
          : captureAiContext(s.editor, workspace, s.revealedNoteId));
      if (!current || current.instance !== s.doc)
        throw new Error("Reopen Ask Knot to capture this document.");
      if (!retry && action === "rewrite" && !current.ranges.length)
        throw new Error("Select text in the editor to rewrite it.");
      if (!retry && action === "insert" && !current.note)
        throw new Error("Open a note to choose where to insert content.");
      const useSources =
        !!cardContext ||
        (resolved !== "explicit" &&
          resolved !== "none" &&
          usesNoteSources(
            sourceScope,
            answers ? "ask" : action,
            input,
            current.label === "Selection" || current.label === "Focused note",
            !!(added.length || passages.length || current.pdf),
          ));
      setContext(current);
      const extra = (cardContext ? [] : passages)
        .filter((p) => !added.some((n) => n.id === p.source.id))
        .map((p) => ({
          document: p.source.id,
          title: p.source.title,
          structure: [p.block],
        }));
      for (const note of retry || cardContext ? [] : added) {
        const loaded = s.collection.getDoc(note.id);
        let text = "";
        if (loaded?.loaded && loaded.root)
          text = JSON.stringify(structuredAiBlocks(loaded.root));
        else {
          const snapshot = await repository.load(note.id);
          if (!snapshot)
            throw new Error(`Context note is unavailable: ${note.title}`);
          text = savedSearchText(note.id, snapshot, true);
        }
        extra.push({
          document: note.id,
          title: note.title,
          structure: JSON.parse(text),
        });
      }
      if (request.current !== id || !mounted.current) return;
      const base =
        retryIndex === undefined
          ? turnsRef.current
          : turnsRef.current.slice(
              0,
              retryIndex - (retry?.role === "assistant" ? 1 : 0),
            );
      let history = outgoingSourceHistory(base, resolved);
      // Earlier messages, so follow-ups and search queries can refer back.
      // Answers, proposals and sources are never repeated.
      if (action === "auto" && !history.length) history = exchangeHistory(base);
      let inheritedContext: string | undefined;
      const inherit =
        !sourceChoicesChanged.current &&
        answers &&
        sourceScope === "auto" &&
        !retry &&
        !added.length &&
        !passages.length &&
        context?.label !== "Selection" &&
        // Automatic messages always read the open note afresh.
        (lastScope === "explicit" ||
          (action !== "auto" && lastScope === "current"))
          ? lastRequest
          : undefined;
      if (inherit) {
        const previous = JSON.parse(inherit.context);
        const table = readCitationSources(inherit.context);
        const eligible = await repository.catalog();
        for (const ref of table) {
          if (ref.kind === "web") continue;
          if (!eligible.some((row) => row.id === ref.document))
            throw Error(
              "An inherited source is unavailable. Choose sources again.",
            );
          const live = s.collection.getDoc(ref.document);
          const snapshot =
            live?.loaded && live.root
              ? null
              : await repository.load(ref.document);
          const blocks =
            live?.loaded && live.root
              ? structuredAiBlocks(live.root)
              : snapshot
                ? JSON.parse(savedSearchText(ref.document, snapshot, true))
                : [];
          if (
            !blocks.some(
              (block: { id: string; text: string }) =>
                block.id === ref.id && block.text.includes(ref.text),
            )
          )
            throw Error("An inherited passage changed. Choose sources again.");
        }
        if (
          inherit.pdfSource &&
          !eligible.some((row) => row.id === previous.document)
        )
          throw Error("The inherited PDF owner is unavailable.");
        inheritedContext = JSON.stringify({
          scope: "Inherited selected sources",
          sourceType: inherit.pdfSource ? "pdf" : undefined,
          document: previous.document,
          title: previous.title,
          text: "",
          structure: [],
          addedNotes: [],
          runs: [],
          citationSources: table,
        });
      }
      const replayContext =
        inheritedContext ??
        (retry?.request?.sourceMode === resolved && resolved !== "none"
          ? retry.request.context
          : retry?.request?.sourceMode === undefined && resolved === "legacy"
            ? retry?.request?.context
            : undefined);
      const selectedImage = cardContext
        ? undefined
        : retry
          ? retry.request?.image
          : image;
      const preparedImage = selectedImage
        ? await prepareAiImage(selectedImage.key)
        : undefined;
      const baseContext = cardContext
        ? cardRequestContext(
            current.document,
            current.structure,
            current.canvasMap,
          )
        : (replayContext ??
          withCitationSources(
            JSON.stringify({
              sourceMode: resolved,
              title: !useSources
                ? undefined
                : current.pdf
                  ? current.label
                  : s.doc.meta?.title,
              scope: !useSources ? "Explicit attachments only" : current.label,
              ...(current.pdf && { sourceType: "pdf" }),
              text: !useSources ? "" : current.text,
              document: !useSources ? undefined : current.document,
              structure: !useSources ? [] : current.structure,
              surroundingReadOnly: !useSources ? [] : current.surrounding,
              mode: action,
              runs: (!useSources && answers ? [] : current.ranges).map((r) => ({
                text: r.text,
                protected: !!(r.attributes.reference || r.attributes.link),
              })),
              ...(preparedImage && {
                attachedImage: {
                  name: selectedImage?.name,
                  ...preparedImage.measurements,
                },
              }),
              addedNotes: extra,
              // Every message while a canvas is open describes its layout.
              ...(useSources && current.canvasMap && {
                canvasMap: current.canvasMap,
              }),
            }),
          ));
      // Saved transcripts of the YouTube cards in these notes (never fetched
      // here). A focused note or selection only brings its own note's cards.
      const videos =
        replayContext || cardContext || current.pdf || !useSources
          ? []
          : (
              await savedTranscripts(
                workspace,
                youtubeCards(
                  s.doc,
                  // A selection brings only its own videos: the selected
                  // objects' (a card on the board has no note), else its note's.
                  current.label === "Selection" && !current.ranges.length
                    ? { blocks: current.selectedBlocks ?? [] }
                    : current.label === "Selection" ||
                        current.label === "Focused note"
                      ? current.note
                      : null,
                ),
              )
            ).map(({ card, transcript }) => ({
              location: {
                videoId: card.videoId,
                documentId: card.documentId,
                blockId: card.blockId,
                title: card.title,
              },
              transcript,
            }));
      if (request.current !== id || !mounted.current) return;
      // Text OCR already read from pictures in the same scope as the videos:
      // questions about an image's words are answered from text.
      const imageTexts =
        replayContext || cardContext || current.pdf || !useSources
          ? []
          : await noteImageTexts(
              noteImageRefs(
                s.doc,
                current.label === "Selection" && !current.ranges.length
                  ? { blocks: current.selectedBlocks ?? [] }
                  : current.label === "Selection" ||
                      current.label === "Focused note"
                    ? current.note
                    : null,
              ),
            );
      const requestContext =
        replayContext ??
        composeAiContext(
          baseContext,
          webSourcesRef.current,
          input,
          videos,
          imageTexts,
        );
      const bytes = (value: string) => new TextEncoder().encode(value).length;
      if (bytes(requestContext) > 180000)
        throw new Error(
          "The selected sources exceed the request limit. Select a smaller passage or choose No note sources. Your message has not been sent.",
        );
      if (
        history.length + 1 > 30 ||
        bytes(history.map((t) => t.content).join("")) + bytes(outgoing) > 120000
      )
        throw new Error(
          "This conversation exceeds the request limit. Start a new chat. Your message has not been sent.",
        );
      const pdfSource = retry
        ? retry.request?.pdfSource
        : !useSources
          ? undefined
          : (inherit?.pdfSource ?? current.pdfSource);
      const pdfInput = pdfSource
        ? await (
            await import("../services/pdf-input")
          ).preparePdfInput(pdfSource)
        : undefined;
      if (request.current !== id || !mounted.current) return;
      // A retried or edited message keeps the chips it was first sent with.
      const attachments =
        retryUser?.request?.attachments ??
        sentAttachments({
          context:
            useSources &&
            !cardContext &&
            !inheritedContext &&
            !current.selectedImageKey &&
            // A website card whose page was fetched shows once, as that page.
            !webSourcesRef.current.some(
              (a) => a.capture && a.url === current.websiteUrl,
            )
              ? {
                  label: current.selectionLabel ?? current.label,
                  title: current.pdf ? undefined : s.doc.meta?.title,
                  document: current.document,
                  first: current.structure[0],
                  pdf: current.pdf ? pdfSource : undefined,
                  selectionKind: current.selectionKind,
                  canvas: current.canvas,
                  blocks: current.selectedBlocks,
                }
              : undefined,
          passages: extra
            .filter(
              (item) =>
                item.structure.length === 1 &&
                passages.some(
                  (p) =>
                    p.source.id === item.document &&
                    p.block.id === item.structure[0].id,
                ),
            )
            .map((item) => ({
              document: item.document,
              title: item.title,
              block: item.structure[0],
            })),
          notes: extra
            .filter((item) => added.some((note) => note.id === item.document))
            .map((item) => ({
              document: item.document,
              title: item.title,
              first: item.structure[0],
            })),
          image: selectedImage,
          web: cardContext
            ? []
            : webSourcesRef.current.flatMap((attempt) =>
                attempt.capture
                  ? [
                      {
                        url: attempt.capture.finalUrl || attempt.url,
                        title: attempt.capture.title,
                      },
                    ]
                  : [],
              ),
          videos: videos.map((video) => ({ ...video.location, start: 0 })),
        });
      const user: Turn = {
        attemptId: id,
        role: "user",
        content: input,
        request: {
          mode: action,
          sourceMode: resolved,
          context: requestContext,
          message: outgoing === input ? undefined : outgoing,
          image: selectedImage,
          pdfSource,
          attachments,
        },
      };
      // Images view_images may show: the focused note's, else the document's.
      // Not with a PDF or slide deck: it is sent itself, and other pictures on
      // the canvas were mistaken for its pages.
      const pictures =
        action === "auto" && !pdfSource ? noteImages(s, current.note) : [];
      // The context a proposal applies to: the retried one, or this capture.
      const editContext: AiContext = retry?.context ?? {
        ...current,
        webContext: requestContext,
      };
      let sentRuns = 0;
      try {
        sentRuns =
          (JSON.parse(requestContext) as { runs?: unknown[] }).runs?.length ??
          0;
      } catch {
        sentRuns = 0;
      }
      const tools: AiTool[] =
        action === "auto"
          ? automaticAiTools(
              options?.answerOnly
                ? {
                    ...abilities,
                    editNote: false,
                    canvasCards: false,
                    quizzes: false,
                  }
                : abilities,
              {
                selection:
                  resolved !== "none" &&
                  resolved !== "explicit" &&
                  sentRuns > 0 &&
                  sentRuns === editContext.ranges.length,
                note: !!editContext.note,
                canvas: !!editContext.canvas,
                editable:
                  !s.doc.readonly &&
                  !editContext.pdf &&
                  editContext.instance === s.doc,
                search: searchAvailable(),
                // Captured websites have their own evidence rules, and the
                // tool is offered only when the message seems to need it.
                web:
                  getAiEnabled() &&
                  getWebSearchEnabled() &&
                  !webSourcesRef.current.length &&
                  wantsWeb(input, base),
                images: !!pictures.length,
                notebook: true,
              },
            )
          : [];
      const chosenModel =
        model === "auto"
          ? automaticAiModel(
              models,
              action === "auto"
                ? tools.length && editIntent(input)
                  ? "rewrite"
                  : "ask"
                : action,
              input,
              !!(selectedImage || pdfSource),
              requestContext.length,
            )
          : model;
      draft = {
        attemptId: id,
        autoModel: model === "auto" ? chosenModel : undefined,
        role: "assistant",
        content: "",
        failed: true,
        request: user.request,
      };
      if (retry && edited === undefined && !options?.inPlace) {
        const branch = crypto.randomUUID();
        chatIdRef.current = branch;
        setChatId(branch);
        // A branch starts its own total; the original chat keeps its spend.
        spentRef.current = noSpend;
      }
      followLatest.current = true;
      update([...base.map((turn) => ({ ...turn })), user, draft]);
      setHistoryOpen(false);
      setEditing(null);
      setCopied(null);
      if (!retry) setPrompt("");
      const result = await streamWithSearch({
        id,
        draft,
        request: user.request!,
        mode: action,
        tools,
        payload: {
          model: chosenModel,
          messages: [...history, { role: user.role, content: outgoing }],
          context: requestContext,
          image: preparedImage?.pixels,
          pdfInput,
          link: retry?.attemptId
            ? {
                parent: retry.attemptId,
                kind:
                  edited !== undefined
                    ? "edited_prompt"
                    : retry.failed
                      ? "retry"
                      : "regeneration",
              }
            : undefined,
        },
        sentFrom: chatIdRef.current,
        images: pictures,
      });
      if (!result || request.current !== id || !mounted.current) return;
      const { output, toolCall, toolArguments } = result;
      const proposed =
        action === "auto"
          ? toolCall && toolCall in AI_TOOL_MODES
            ? AI_TOOL_MODES[toolCall as keyof typeof AI_TOOL_MODES]
            : undefined
          : action === "ask"
            ? undefined
            : action;
      if (proposed) {
        try {
          draft.proposal = validateProposal(
            action === "auto"
              ? // Each tool sends only its own field; restore the other.
                { replacements: [], blocks: [], ...JSON.parse(toolArguments) }
              : JSON.parse(output),
            requestContext,
          );
          // Questions go into the note only when it may be edited.
          if (
            proposed === "quiz" &&
            draft.proposal.target === "note" &&
            (!abilities.editNote || !editContext.note)
          )
            draft.proposal.target = "card";
          if (
            action === "auto" &&
            proposed === "rewrite" &&
            draft.proposal.replacements.length !== editContext.ranges.length
          )
            throw new Error("The edit response is invalid. Please try again.");
          recordAiOutcome(id, "proposal_valid");
        } catch (error) {
          recordAiOutcome(id, "proposal_invalid");
          throw error;
        }
        draft.context =
          action === "auto"
            ? editContext
            : retry
              ? retry.context
              : { ...current, webContext: requestContext };
        draft.mode = proposed;
        // A card suggestion replaces its card; a retry keeps doing so.
        draft.replaces =
          proposed === "canvas"
            ? (cardContext?.note ??
              retry?.replaces ??
              (retryIndex === undefined
                ? undefined
                : turnsRef.current[retryIndex + 1]?.replaces) ??
              undefined)
            : undefined;
        draft.uncovered = draft.replaces
          ? uncoveredPassages(
              (draft.context?.structure ?? []).map((b) => b.text),
              [
                ...draft.proposal.blocks.map(aiBlockText),
                ...(draft.proposal.connections ?? []).map((c) => c.label),
                ...(draft.proposal.mindmap ?? []).map((n) => n.text),
              ],
            ).length
          : undefined;
        const label =
          proposed === "rewrite"
            ? "Suggested rewrite"
            : proposed === "note"
              ? "Suggested note"
              : proposed === "quiz"
                ? "Suggested quiz"
                : "Suggested addition";
        draft.content = action === "auto" ? output.trim() || label : label;
      }
      draft.preparing = undefined;
      draft.elapsedSeconds = responseElapsedSeconds(requestStartedAt.current);
      draft.failed = false;
      update([...turnsRef.current]);
    } catch (e) {
      if (mounted.current && request.current === id) setError(String(e));
      if (draft && request.current === id) {
        draft.elapsedSeconds = responseElapsedSeconds(requestStartedAt.current);
        draft.failed = true;
        draft.preparing = undefined;
        draft.activity = undefined;
        if (!draft.content) draft.content = "Response interrupted. Try again.";
        update([...turnsRef.current]);
      }
    } finally {
      if (request.current === id) {
        clearStreamTimer();
        request.current = null;
        automaticRequest.current = false;
        if (mounted.current) {
          setBusy(false);
          setRetrievalStatus("");
        }
      }
    }
  }
  return (
    <section className="ask-knot" aria-label="Ask Knot chat">
      <header className="ask-header">
        <h2>
          <ShellIcon name="sparkles" /> Ask Knot
        </h2>
        <div className="ask-header-actions">
          <button
            aria-label={historyOpen ? "Back to chat" : "Chat history"}
            data-tooltip={historyOpen ? "Back to chat" : "Chat history"}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <ShellIcon name={historyOpen ? "back" : "history"} />
          </button>
          <button
            aria-label="New chat"
            data-tooltip="New chat"
            disabled={busy}
            onClick={() => {
              openChat();
            }}
          >
            <ShellIcon name="rename" />
          </button>
          <button
            aria-label="Connection"
            data-tooltip="Connection settings"
            onClick={() => {
              setHistoryOpen(false);
              setSettings(!settings);
            }}
            aria-expanded={settings}
          >
            <ShellIcon name="options" />
          </button>
          <button
            data-panel-close
            aria-label="Close Ask Knot"
            data-tooltip="Close panel"
            onClick={onClose}
          >
            <ShellIcon name="close" />
          </button>
        </div>
      </header>
      {historyOpen && (
        <div className="ask-history" aria-label="Saved chats">
          <div className="ask-history-heading">
            Chat history <span>{chats.length}</span>
          </div>
          {!chats.length && <p>Your conversations will appear here.</p>}
          {chats.map((chat) => (
            <div className="ask-history-row" key={chat.id}>
              <button
                className="ask-history-item"
                disabled={busy}
                aria-current={chat.id === chatId ? "true" : undefined}
                onClick={() => openChat(chat)}
              >
                <ShellIcon name="history" />
                <span>
                  <strong>{chat.title}</strong>
                  <small>
                    {new Date(chat.updated).toLocaleDateString()} ·{" "}
                    {chat.turns.length} messages
                    {!!chat.spent?.priced &&
                      ` · ≈ ${formatUsd(chat.spent.usd)}`}
                  </small>
                </span>
              </button>
              <button
                className="ask-icon-button"
                aria-label={`Delete chat: ${chat.title}`}
                disabled={busy}
                onClick={() => setDeleting(chat.id)}
              >
                <ShellIcon name="trash" />
              </button>
              {deleting === chat.id && (
                <div className="ask-delete-confirm">
                  <span>Delete this chat permanently?</span>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await deleteChatRecord(workspace, chat.id);
                        if (!mounted.current) return;
                        setChats((previous) =>
                          previous.filter((c) => c.id !== chat.id),
                        );
                        if (chat.id === chatIdRef.current) {
                          openChat();
                          setHistoryOpen(true);
                        }
                        setDeleting(null);
                      } catch {
                        if (mounted.current)
                          setSaveError(
                            "Could not delete this chat. Please try again.",
                          );
                      }
                    }}
                  >
                    Delete
                  </button>
                  <button onClick={() => setDeleting(null)}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!historyOpen && (
        <>
          {settings && (
            <section className="ask-connection" aria-label="OpenAI connection">
              <div className="ask-connection-heading">
                <div>
                  <strong>OpenAI</strong>
                  <span
                    className="ask-connection-status"
                    data-connected={connected}
                  >
                    <i aria-hidden="true" />
                    {connected ? "Connected" : "Not connected"}
                  </span>
                </div>
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    void invoke("ai_open_api_keys").catch(() =>
                      setError(
                        "Could not open your browser. Visit https://platform.openai.com/api-keys to get an API key.",
                      ),
                    );
                  }}
                >
                  Get an API key <span aria-hidden="true">↗</span>
                </a>
              </div>
              {!connected || editingKey ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!connecting && !busy && apiKey.trim()) void connect();
                  }}
                >
                  <label htmlFor="openai-api-key">
                    {connected ? "New API key" : "API key"}
                  </label>
                  <input
                    id="openai-api-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="OpenAI API key"
                    placeholder="Paste your API key"
                    value={apiKey}
                    disabled={connecting || busy}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <div className="ask-connection-actions">
                    <button
                      className="ask-connect-primary"
                      type="submit"
                      disabled={connecting || !apiKey.trim() || busy}
                    >
                      {connecting
                        ? "Connecting…"
                        : connected
                          ? "Update key"
                          : "Connect"}
                    </button>
                    {connected && (
                      <button
                        type="button"
                        disabled={connecting}
                        onClick={() => {
                          setEditingKey(false);
                          setApiKey("");
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                <div className="ask-connection-actions">
                  <button
                    disabled={busy || connecting}
                    onClick={() => setEditingKey(true)}
                  >
                    Change key
                  </button>
                  <button
                    disabled={busy || connecting}
                    onClick={async () => {
                      setConnecting(true);
                      setError("");
                      try {
                        await invoke("ai_disconnect");
                        setConnected(false);
                        setModels([]);
                        setModel("");
                        setApiKey("");
                        setEditingKey(false);
                      } catch (cause) {
                        setError(String(cause));
                      } finally {
                        setConnecting(false);
                      }
                    }}
                  >
                    {connecting ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              )}
              <p className="ask-connection-caption">
                Use your own key. API usage is billed by OpenAI.
              </p>
              <details className="ask-connection-privacy">
                <summary>Privacy &amp; storage</summary>
                <p>
                  Your key is stored in Windows Credential Manager. Context
                  shown here is sent when you ask. If AI suggestions are
                  enabled, current note excerpts are also sent when you open an
                  empty chat. Chats are saved in this workspace and included in
                  its backups.
                </p>
              </details>
            </section>
          )}
          <div
            className="ask-messages"
            role="log"
            aria-label="Conversation"
            ref={messages}
            onScroll={(event) => {
              const el = event.currentTarget;
              followLatest.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
          >
            {!turns.length && (
              <div className="ask-empty">
                <Mascot mood="ask" />
                <h3>Where should we start?</h3>
                <p>
                  Make sense of your notes, find the right words, or turn an
                  idea into a first draft.
                </p>
                <AiStarters
                  capture={captureStarter}
                  model={
                    model === "auto" && models.length
                      ? automaticAiModel(models, "ask", "", false, 0)
                      : model
                  }
                  eligible={
                    connected &&
                    modelStatus === "ready" &&
                    models.length > 0 &&
                    !busy &&
                    !prompt &&
                    sourceScope !== "none" &&
                    sourceScope !== "workspace" &&
                    !passages.length &&
                    !added.length &&
                    !image &&
                    !webSources.length &&
                    !context?.pdf &&
                    !context?.ranges.length
                  }
                  onChoose={(text, captured) => {
                    setSourceScope("current");
                    void send(undefined, text, undefined, captured);
                  }}
                />
                <div className="ask-suggestions">
                  {[
                    "Summarize this",
                    "Explain this",
                    "What are the key takeaways?",
                  ].map((text) => (
                    <AskSuggestion
                      key={text}
                      label={text}
                      icon={
                        text === "Summarize this"
                          ? "note"
                          : text === "Explain this"
                            ? "search"
                            : "sparkles"
                      }
                      onClick={() => setPrompt(text)}
                    />
                  ))}
                </div>
              </div>
            )}
            {turns.map((turn, i) => (
              <article key={i} className={`ask-turn ask-${turn.role}`}>
                {turn.role === "assistant" && (
                  <div className="ask-author">
                    <ShellIcon name="sparkles" />
                    <span>
                      Knot
                      {turn.autoModel && ` · ${aiModelName(turn.autoModel)}`}
                    </span>
                    {busy && turn.attemptId === request.current ? (
                      <ResponseTimer
                        key={turn.attemptId}
                        startedAt={requestStartedAt.current}
                      />
                    ) : (
                      turn.elapsedSeconds !== undefined && (
                        <ResponseDuration seconds={turn.elapsedSeconds} />
                      )
                    )}
                    {turn.cost && (
                      <span
                        className="ask-response-cost"
                        tabIndex={0}
                        data-tooltip={costDetail(turn.cost)}
                        aria-label={`${turn.cost.usd === null ? "Cost unknown" : `Estimated cost ${formatUsd(turn.cost.usd)}`}. ${costDetail(turn.cost)}`}
                      >
                        {turn.cost.usd === null
                          ? "Cost unknown"
                          : `≈ ${formatUsd(turn.cost.usd)}`}
                      </span>
                    )}
                  </div>
                )}
                {turn.role === "user" && turn.request?.image && (
                  <AttachmentImage image={turn.request.image} />
                )}
                {turn.role === "user" && turn.request && editing !== i && (
                  <SentAttachments
                    request={turn.request}
                    onOpen={openAttachment}
                  />
                )}
                {editing === i ? (
                  <div className="ask-edit-message">
                    <textarea
                      autoFocus
                      aria-label="Edit message"
                      value={editedText}
                      disabled={busy}
                      onChange={(e) => setEditedText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <small>
                      Sending replaces this message and removes all later
                      messages.
                    </small>
                    <div>
                      <button disabled={busy} onClick={() => setEditing(null)}>
                        Cancel edit
                      </button>
                      <button
                        disabled={
                          busy ||
                          !editedText.trim() ||
                          !connected ||
                          !models.length
                        }
                        onClick={() => void send(i, editedText)}
                      >
                        Save & send
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="ask-message-text">
                    {turn.role === "assistant" && (
                      <>
                        <WebCoverage context={turn.request?.context} />
                        <WorkspaceCoverage
                          context={shownContext(turn.request)}
                        />
                      </>
                    )}
                    {turn.content ? (
                      turn.role === "assistant" && !turn.proposal ? (
                        <>
                          <ChatText
                            text={turn.content}
                            context={shownContext(turn.request)}
                          />
                          <CitationSources
                            text={turn.content}
                            context={shownContext(turn.request)}
                            finding={turn.findingExcerpts}
                            onSource={onSource}
                          />
                        </>
                      ) : (
                        turn.content
                      )
                    ) : (
                      <span className="ask-thinking">
                        {turn.activity
                          ? turn.activity
                          : turn.preparing ||
                              (turn.request &&
                                turn.request.mode !== "ask" &&
                                turn.request.mode !== "auto")
                            ? "Preparing preview"
                            : "Thinking"}
                        <span>…</span>
                      </span>
                    )}
                    {turn.preparing && turn.content && (
                      <span className="ask-thinking">
                        Preparing preview<span>…</span>
                      </span>
                    )}
                  </div>
                )}
                {turn.failed &&
                  turn.content &&
                  !(busy && i === turns.length - 1) && (
                    <small>Incomplete response</small>
                  )}
                {turn.proposal && (
                  <div className="ask-proposal">
                    <span>
                      {turn.mode === "rewrite"
                        ? "Replace selection"
                        : turn.mode === "canvas"
                          ? turn.replaces
                            ? `Replace the card with ${turn.proposal.blocks.length + (turn.uncovered ? 1 : 0)} idea cards`
                            : turn.proposal.mindmap?.length &&
                                !turn.proposal.blocks.length
                              ? "Create mind map"
                              : "Create on canvas"
                          : turn.mode === "note"
                            ? "Create note in this notebook"
                            : turn.mode === "quiz"
                              ? `${turn.proposal.target === "note" ? "Add" : "Create quiz card with"} ${turn.proposal.questions?.length ?? 0} ${turn.proposal.questions?.length === 1 ? "question" : "questions"}${turn.proposal.target === "note" ? " to note" : ""}`
                              : "Append to note"}
                    </span>
                    <AiProposalPreview>
                      {turn.mode === "rewrite" && (
                        <del>
                          {turn.context?.ranges.map((r) => r.text).join("")}
                        </del>
                      )}
                      <div className="ask-preview">
                        {turn.replaces && (
                          <p className="ask-replace-note">
                            {turn.uncovered
                              ? `${turn.uncovered} ${turn.uncovered === 1 ? "passage isn’t" : "passages aren’t"} covered by the cards; ${turn.uncovered === 1 ? "it’s" : "they’re"} kept word for word on an “Other details” card.`
                              : "Everything in the original is covered."}{" "}
                            The original goes to Trash; Undo brings it back.
                          </p>
                        )}
                        {turn.proposal.mindmap?.map((node, i, nodes) => (
                          <p key={i}>
                            {node.parent < 0 ? (
                              <strong>{node.text}</strong>
                            ) : (
                              `${nodes[node.parent].text} → ${node.text}`
                            )}
                          </p>
                        ))}
                        {turn.mode === "canvas" &&
                          !!turn.proposal.blocks.length && (
                            <p>
                              Create {turn.proposal.blocks.length} cards and{" "}
                              {turn.proposal.connections?.length ?? 0} arrows.
                            </p>
                          )}
                        {turn.mode === "canvas" &&
                          turn.proposal.connections?.map((c, i) => (
                            <p key={`edge-${i}`}>
                              Card {c.from + 1} → Card {c.to + 1}: {c.label}
                            </p>
                          ))}
                        {turn.proposal.questions && (
                          <ol className="ask-quiz-preview">
                            {turn.proposal.questions.map((q, n) => (
                              <li key={n}>
                                <p>{q.question}</p>
                                <ul>
                                  {q.options.map((option, o) => (
                                    <li
                                      key={o}
                                      data-correct={o === q.correct || undefined}
                                    >
                                      <span aria-hidden="true">
                                        {"ABCD"[o]}
                                      </span>
                                      <span>{option}</span>
                                      {o === q.correct && (
                                        <span
                                          className="ask-quiz-correct"
                                          role="img"
                                          aria-label="Correct answer"
                                        >
                                          <ShellIcon name="check" />
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                                {q.explanation && <small>{q.explanation}</small>}
                              </li>
                            ))}
                          </ol>
                        )}
                        {turn.mode === "rewrite" ? (
                          turn.proposal.replacements.join("")
                        ) : (
                          <AiBlocksPreview
                            blocks={turn.proposal.blocks}
                            context={turn.request?.context}
                          />
                        )}
                      </div>
                    </AiProposalPreview>
                    {!turn.status && !turn.context ? (
                      <small>
                        Saved preview · copy it, or start a new request to make
                        an edit.
                      </small>
                    ) : !turn.status ? (
                      <div className="ask-proposal-actions">
                        <button
                          disabled={busy}
                          onClick={() => {
                            try {
                              const s = getSession();
                              if (!s) throw Error("Document closed");
                              const undo = applyAiProposal(
                                s.doc,
                                workspace,
                                turn.context!,
                                turn.proposal!,
                                turn.mode!,
                                turn.replaces
                                  ? { replaces: turn.replaces }
                                  : undefined,
                              );
                              turn.undo = undo;
                              // A new note stays where it was put; Open note
                              // goes to it without leaving your view.
                              const first = undo.noteId
                                ? s.doc.getBlock(undo.noteId)?.model.children[0]
                                : undefined;
                              if (first)
                                turn.createdNote = {
                                  block: first.id,
                                  text: first.text?.toString() ?? "",
                                };
                              recordAiOutcome(turn.attemptId, "apply");
                              turn.status = "applied";
                              update([...turns]);
                              setError("");
                            } catch (e) {
                              recordAiOutcome(turn.attemptId, "apply_failed");
                              setError(String(e));
                            }
                          }}
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => {
                            recordAiOutcome(turn.attemptId, "dismiss");
                            turn.status = "dismissed";
                            update([...turns]);
                          }}
                        >
                          Dismiss
                        </button>
                        {turn.request?.mode === "auto" &&
                          i === turns.length - 1 && (
                            <button
                              className="ask-answer-instead"
                              disabled={busy || !connected || !models.length}
                              onClick={() => {
                                recordAiOutcome(turn.attemptId, "dismiss");
                                void send(
                                  i,
                                  undefined,
                                  undefined,
                                  undefined,
                                  undefined,
                                  { inPlace: true, answerOnly: true },
                                );
                              }}
                            >
                              Just answer instead
                            </button>
                          )}
                      </div>
                    ) : (
                      <div className="ask-proposal-actions">
                        <small>
                          {turn.status === "applied" ? "Applied" : "Dismissed"}
                        </small>
                        {turn.status === "applied" &&
                          turn.createdNote &&
                          turn.context && (
                            <button
                              onClick={() => {
                                setError("");
                                void onSource(
                                  turn.context!.document,
                                  turn.createdNote!.block,
                                  turn.createdNote!.text,
                                ).catch((e) => setError(String(e)));
                              }}
                            >
                              {turn.mode === "quiz"
                                ? "Open quiz"
                                : turn.mode === "canvas"
                                  ? turn.proposal!.blocks.length > 1
                                    ? "Open cards"
                                    : "Open card"
                                  : "Open note"}
                            </button>
                          )}
                        {turn.undo && (
                          <button
                            onClick={() => {
                              try {
                                if (
                                  getSession()?.doc !== turn.context?.instance
                                )
                                  throw Error(
                                    "Reopened document: use editor Undo if available.",
                                  );
                                turn.undo!();
                                recordAiOutcome(turn.attemptId, "undo");
                                turn.undo = undefined;
                                turn.createdNote = undefined;
                                turn.status = "dismissed";
                                update([...turns]);
                              } catch (e) {
                                recordAiOutcome(turn.attemptId, "undo_failed");
                                setError(String(e));
                              }
                            }}
                          >
                            Undo edit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {editing !== i && (
                  <div className="ask-message-actions">
                    <button
                      aria-label="Copy message"
                      data-tooltip={copied === i ? "Copied" : "Copy message"}
                      disabled={
                        !turn.content || (busy && i === turns.length - 1)
                      }
                      onClick={() => void copyTurn(turn, i)}
                    >
                      <ShellIcon name={copied === i ? "check" : "copy"} />
                      {copied === i && <span>Copied</span>}
                    </button>
                    {turn.role === "assistant" && (
                      <button
                        aria-label="Add reply as one card"
                        data-tooltip={
                          cardAdded?.index === i
                            ? "Card added"
                            : "Add reply as one card"
                        }
                        disabled={
                          !turn.content ||
                          busy ||
                          !getSession() ||
                          getSession()?.doc.readonly
                        }
                        onClick={() => addTurnAsCard(turn, i)}
                      >
                        <ShellIcon
                          name={cardAdded?.index === i ? "check" : "cardPlus"}
                        />
                        {cardAdded?.index === i && (
                          <span role="status">Card added</span>
                        )}
                      </button>
                    )}
                    {cardAdded?.index === i && cardAdded.block && (
                      <button
                        aria-label="Open card"
                        data-tooltip="Open card"
                        onClick={() => {
                          setError("");
                          void onSource(
                            cardAdded.document,
                            cardAdded.block,
                            cardAdded.text,
                          ).catch((e) => setError(String(e)));
                        }}
                      >
                        <ShellIcon name="locate" />
                        <span>Open card</span>
                      </button>
                    )}
                    {turn.role === "assistant" &&
                      !turn.proposal &&
                      !turn.failed &&
                      !!turn.content &&
                      !!getSession() &&
                      !getSession()?.doc.readonly &&
                      !context?.pdf &&
                      (context?.canvas ? (
                        <button
                          aria-label="Split into cards with AI"
                          data-tooltip="Split into cards with AI"
                          disabled={busy || !connected || !models.length}
                          onClick={() => sendAnswerTo(turn, "canvas")}
                        >
                          <ShellIcon name="board" />
                        </button>
                      ) : (
                        context?.note && (
                          <button
                            aria-label="Insert into note"
                            data-tooltip="Insert into note"
                            disabled={busy || !connected || !models.length}
                            onClick={() => sendAnswerTo(turn, "insert")}
                          >
                            <ShellIcon name="note" />
                          </button>
                        )
                      ))}
                    <button
                      aria-label={
                        turn.role === "assistant"
                          ? "Regenerate response"
                          : "Edit message"
                      }
                      data-tooltip={
                        turn.role === "assistant"
                          ? "Regenerate in a new chat"
                          : "Edit message"
                      }
                      disabled={
                        busy ||
                        editing !== null ||
                        (turn.role === "assistant" &&
                          (!connected || !models.length || !turn.request))
                      }
                      onClick={() => {
                        if (turn.role === "user") {
                          setEditing(i);
                          setEditedText(turn.content);
                        } else void send(i);
                      }}
                    >
                      <ShellIcon
                        name={turn.role === "user" ? "rename" : "refresh"}
                      />
                    </button>
                  </div>
                )}
              </article>
            ))}
            {(spent.priced > 0 || spent.unpriced > 0) && (
              <p
                className="ask-chat-cost"
                tabIndex={0}
                data-tooltip={spentDetail(spent)}
                aria-label={`This chat: about ${formatUsd(spent.usd)}. ${spentDetail(spent)}`}
              >
                This chat ≈ {formatUsd(spent.usd)}
                {spent.unpriced > 0 && ` + ${spent.unpriced} unpriced`}
              </p>
            )}
          </div>
          <div className="ask-compose">
            {saveError && (
              <div className="ask-error" role="alert">
                {saveError}
                <button onClick={() => update([...turnsRef.current])}>
                  Retry save
                </button>
              </div>
            )}
            {error && (
              <div className="ask-error" role="alert">
                {error}
                <button
                  aria-label="Dismiss AI error"
                  onClick={() => setError("")}
                >
                  ×
                </button>
              </div>
            )}
            <div
              className="ask-composer-box"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) void attachFile(file);
              }}
              onPaste={(e) => {
                const file = Array.from(e.clipboardData.files).find((f) =>
                  f.type.startsWith("image/"),
                );
                if (file) {
                  e.preventDefault();
                  void attachFile(file);
                }
              }}
            >
              {retrievalStatus && (
                <small role="status">{retrievalStatus}</small>
              )}
              <div className="ask-context">
                {sourceScope === "auto" &&
                  (resolvedScope === "explicit" ||
                    resolvedScope === "current") &&
                  lastRequest &&
                  !sourceChoicesChanged.current && (
                    <span className="ask-chip">
                      Selected sources · inherited
                    </span>
                  )}
                {includeSources &&
                  !context?.selectedImageKey &&
                  !webSources.some((s) => s.url === context?.websiteUrl) && (
                    <button
                      type="button"
                      className="ask-chip"
                      disabled={busy}
                      aria-pressed={includeSources}
                      aria-label={
                        !includeSources
                          ? "Include note context"
                          : "Exclude note context"
                      }
                      title={
                        !includeSources
                          ? "Click to include note context"
                          : "Click to exclude note context"
                      }
                      onClick={() =>
                        setSourceScope(includeSources ? "none" : "current")
                      }
                    >
                      <ShellIcon
                        name={
                          context?.pdf
                            ? "pdf"
                            : context?.selectionKind === "website"
                              ? "link"
                              : context?.selectionKind === "file"
                                ? "attach"
                                : context?.label === "Canvas text"
                                  ? "board"
                                  : "note"
                        }
                      />
                      <span className="ask-chip-label">
                        {context?.selectionLabel ?? context?.label ?? "Page"}
                      </span>
                      <ShellIcon name="close" />
                    </button>
                  )}
                {uploadScope && !image && (
                  <span className="ask-chip">
                    <ShellIcon name="attach" />
                    <span>
                      {uploadScope} · {attaching ? "Preparing" : "Unavailable"}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove unavailable attachment"
                      disabled={busy || attaching}
                      onClick={() => {
                        uploadId.current++;
                        setUploadScope(undefined);
                        sourceChoicesChanged.current = true;
                        setError("");
                      }}
                    >
                      ×
                    </button>
                  </span>
                )}
                {image && (
                  <div className="ask-image-attachment">
                    <AttachmentImage image={image} />
                    <button
                      aria-label="Remove image"
                      disabled={busy}
                      onClick={() => {
                        sourceChoicesChanged.current = true;
                        setImage(undefined);
                        if (context?.selectedImageKey) setSourceScope("none");
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
                {passages.map((p) => (
                  <button
                    className="ask-chip"
                    key={JSON.stringify([p.source.id, p.block.id])}
                    title={p.block.text}
                    onClick={() => {
                      sourceChoicesChanged.current = true;
                      setPassages(passages.filter((item) => item !== p));
                    }}
                  >
                    <ShellIcon name="note" />
                    <span className="ask-chip-label">
                      {p.source.title} · {p.label.slice(0, 32)}
                    </span>
                    <ShellIcon name="close" />
                  </button>
                ))}
                {added.map((note) => (
                  <button
                    className="ask-chip"
                    key={note.id}
                    onClick={() =>
                      setAdded(added.filter((n) => n.id !== note.id))
                    }
                  >
                    <ShellIcon name="note" />
                    <span className="ask-chip-label">{note.title}</span>
                    <ShellIcon name="close" />
                  </button>
                ))}
              </div>
              <WebSourceList
                sources={webSources}
                busy={busy}
                onCapture={(source) => {
                  invalidateWebProposals();
                  const next: WebAttempt = {
                    id: source.id,
                    url: source.url,
                    state: "queued",
                  };
                  updateWebSources(
                    webSourcesRef.current.map((s) =>
                      s.id === next.id ? next : s,
                    ),
                  );
                  setBusy(true);
                  void captureWebSources([next]).finally(() => {
                    if (mounted.current && !request.current) setBusy(false);
                  });
                }}
                onRemove={(id) => {
                  sourceChoicesChanged.current = true;
                  const source = webSourcesRef.current.find((s) => s.id === id);
                  if (source) excludedUrls.current.add(source.url);
                  invalidateWebProposals();
                  updateWebSources(
                    webSourcesRef.current.filter((s) => s.id !== id),
                  );
                }}
              />
              <textarea
                aria-label="Ask Knot message"
                placeholder={
                  image
                    ? "Ask about colors, objects, or what the image conveys…"
                    : "Ask, write, or edit…"
                }
                value={prompt}
                disabled={busy || editing !== null}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {connected && modelStatus === "ready" && !models.length && (
                <p className="ask-model-notice" role="status">
                  No enabled models available. Check Settings → AI.
                </p>
              )}
              {attaching && <small role="status">Preparing image...</small>}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void attachFile(file);
                  e.target.value = "";
                }}
              />
              <div className="ask-compose-actions">
                <ContextAttachments
                  disabled={busy || attaching}
                  images={imageSources}
                  collection={getSession()?.collection}
                  onImage={(value) => {
                    sourceChoicesChanged.current = true;
                    uploadId.current++;
                    setUploadScope(undefined);
                    setImage(value);
                  }}
                  onUpload={() => fileInput.current?.click()}
                  onNote={(note) => {
                    sourceChoicesChanged.current = true;
                    setAdded((prev) =>
                      prev.some((n) => n.id === note.id)
                        ? prev
                        : [...prev, note],
                    );
                    setSourceScope("auto");
                  }}
                  onPassage={(p) => {
                    sourceChoicesChanged.current = true;
                    setPassages((prev) =>
                      prev.some(
                        (item) =>
                          item.source.id === p.source.id &&
                          item.block.id === p.block.id,
                      )
                        ? prev
                        : [...prev, p],
                    );
                    setSourceScope("auto");
                  }}
                  onUrls={(urls) => {
                    sourceChoicesChanged.current = true;
                    urls.forEach((url) => excludedUrls.current.delete(url));
                    addWebUrls(urls);
                  }}
                  onCurrent={() => {
                    sourceChoicesChanged.current = true;
                    refresh(true);
                    setSourceScope("current");
                  }}
                />
                <Popover
                  label="Abilities"
                  placement="top"
                  className="ask-abilities-button"
                  trigger={
                    <>
                      <ShellIcon name="sparkles" />
                      {chatAbilities && (
                        <span
                          className="ask-abilities-dot"
                          aria-label="Changed for this chat"
                        />
                      )}
                    </>
                  }
                >
                  {() => (
                    <div className="ask-abilities">
                      <p>What Knot may suggest on its own in this chat</p>
                      <div
                        role="group"
                        aria-label="Abilities"
                        className="library-filter-options"
                        onKeyDown={(event) => {
                          if (!["ArrowDown", "ArrowUp"].includes(event.key))
                            return;
                          const buttons = Array.from(
                            event.currentTarget.querySelectorAll<HTMLButtonElement>(
                              "button:not(:disabled)",
                            ),
                          );
                          const index = buttons.indexOf(
                            document.activeElement as HTMLButtonElement,
                          );
                          event.preventDefault();
                          buttons[
                            (index +
                              (event.key === "ArrowDown" ? 1 : -1) +
                              buttons.length) %
                              buttons.length
                          ]?.focus();
                        }}
                      >
                        {(
                          [
                            ["searchWorkspace", "Search my workspace"],
                            ["searchWeb", "Search the web"],
                            ["viewImages", "Look at images"],
                            ["editNote", "Edit the current note"],
                            ["canvasCards", "Create cards on canvas"],
                            ["createNotes", "Create new notes"],
                            ["quizzes", "Make quizzes"],
                          ] as const
                        ).map(([key, label], index) => (
                          <button
                            key={key}
                            autoFocus={index === 0}
                            disabled={settingOff(key)}
                            title={
                              settingOff(key)
                                ? "Turned off in Settings → AI"
                                : undefined
                            }
                            role="switch"
                            className="ask-ability"
                            aria-checked={
                              settingOff(key) ? false : abilities[key]
                            }
                            onClick={() => {
                              const next = {
                                ...abilities,
                                [key]: !abilities[key],
                              };
                              changeAbilities(
                                (
                                  Object.keys(next) as (keyof AiAbilities)[]
                                ).every(
                                  (name) =>
                                    next[name] === defaultAbilities[name],
                                )
                                  ? undefined
                                  : next,
                              );
                            }}
                          >
                            <span>{label}</span>
                            {/* The same switch as Settings → AI. */}
                            <span className="knot-switch" aria-hidden="true">
                              <span />
                            </span>
                          </button>
                        ))}
                      </div>
                      <small>
                        {chatAbilities
                          ? "Changed for this chat. Defaults are in Settings → AI."
                          : "Defaults from Settings → AI."}
                      </small>
                    </div>
                  )}
                </Popover>

                <select
                  aria-label="AI model"
                  value={model}
                  disabled={busy || !models.length}
                  onChange={(e) => {
                    setModel(e.target.value);
                    saveAiModelChoice(e.target.value);
                  }}
                >
                  {!models.length && (
                    <option value={model}>
                      {modelStatus === "loading"
                        ? "Loading models…"
                        : !connected
                          ? "Connect OpenAI"
                          : modelStatus === "error"
                            ? "Models unavailable"
                            : "No models available"}
                    </option>
                  )}
                  {!!models.length && <option value="auto">Automatic</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {aiModelName(m)}
                    </option>
                  ))}
                </select>
                {busy ? (
                  <button
                    className="ask-send ask-stop"
                    aria-label="Stop"
                    onClick={() => {
                      retrievalAbort.current?.abort();
                      clearStreamTimer();
                      sourceCoordinator.current.cancel();
                      const id = request.current;
                      request.current = null;
                      setBusy(false);
                      if (id)
                        void invoke("ai_cancel", {
                          id: inflight.current ?? id,
                        });
                      const last = turnsRef.current.at(-1);
                      if (last?.role === "assistant" && last.attemptId === id) {
                        last.elapsedSeconds = responseElapsedSeconds(
                          requestStartedAt.current,
                        );
                        last.failed = true;
                        last.content ||= "Stopped";
                        update([...turnsRef.current]);
                      }
                    }}
                  >
                    <ShellIcon name="stop" />
                  </button>
                ) : (
                  <button
                    className="ask-send"
                    aria-label="Send to Knot"
                    disabled={
                      attaching ||
                      editing !== null ||
                      !connected ||
                      !models.length ||
                      !prompt.trim()
                    }
                    onClick={() => void send()}
                  >
                    <ShellIcon name="arrowUp" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      {historyOpen && saveError && (
        <div className="ask-error" role="alert">
          {saveError}
        </div>
      )}
    </section>
  );
}

function responseElapsedSeconds(startedAt: number) {
  return Math.floor((performance.now() - startedAt) / 1000);
}

function ResponseTimer({ startedAt }: { startedAt: number }) {
  const [seconds, setSeconds] = useState(() =>
    responseElapsedSeconds(startedAt),
  );

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    function tick() {
      const elapsed = performance.now() - startedAt;
      setSeconds(Math.floor(elapsed / 1000));
      timeout = setTimeout(tick, 1000 - (elapsed % 1000));
    }
    tick();
    return () => clearTimeout(timeout);
  }, [startedAt]);

  return <ResponseDuration seconds={seconds} />;
}

function ResponseDuration({ seconds }: { seconds: number }) {
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return (
    <span
      className="ask-response-timer"
      role="timer"
      aria-label="Response time elapsed"
    >
      {minutes}:{remainder}
    </span>
  );
}

/** Small, safe prose view: model output always stays React text, never HTML. */
const ChatText = memo(function ChatText({
  text,
  context,
}: {
  text: string;
  context?: string;
}) {
  const table = readCitationSources(context);
  const validMarkers = new Set(
    table.map((source, index) => source.citation ?? `[S${index + 1}]`),
  );
  // Transcript citations read as the moment they cite: "▶ 12:24".
  const moments = new Map<string, number>();
  table.forEach((source, index) => {
    if (
      source.kind !== "link" &&
      source.kind !== "web" &&
      source.kind !== "image" &&
      source.video
    )
      moments.set(source.citation ?? `[S${index + 1}]`, source.video.start);
  });
  const ids = citationIds(text);
  const inline = (value: string) =>
    value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g).map((part, i) =>
      moments.has(part) ? (
        <sup
          className="ask-ref ask-ref-video"
          key={i}
          aria-label={`Source ${ids.indexOf(Number(part.slice(2, -1))) + 1}, video at ${formatTimestamp(moments.get(part)!)}`}
        >
          ▶ {formatTimestamp(moments.get(part)!)}
        </sup>
      ) : /^\[S\d+\]$/.test(part) && validMarkers.has(part) ? (
        <sup
          className="ask-ref"
          key={i}
          aria-label={`Source ${ids.indexOf(Number(part.slice(2, -1))) + 1}`}
        >
          {ids.indexOf(Number(part.slice(2, -1))) + 1}
        </sup>
      ) : part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.endsWith("`") ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
  const lines = text.split("\n");
  const parts = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const key = i;
    if (line.startsWith("```")) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i++]);
      if (i < lines.length) i++;
      parts.push(
        <pre key={key}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
    } else if (/^#{1,3} /.test(line)) {
      parts.push(<h4 key={key}>{inline(line.replace(/^#{1,3} /, ""))}</h4>);
      i++;
    } else if (/^([-*] |\d+\. )/.test(line)) {
      const numbered = /^\d+\. /.test(line);
      const pattern = numbered ? /^\d+\. / : /^[-*] /;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i++].replace(pattern, ""))}</li>);
      }
      parts.push(
        numbered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>,
      );
    } else {
      const paragraph = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,3} |[-*] |\d+\. |```)/.test(lines[i])
      )
        paragraph.push(lines[i++]);
      parts.push(<p key={key}>{inline(paragraph.join("\n"))}</p>);
    }
  }
  return <div className="ask-prose">{parts}</div>;
});

const CitationSources = memo(function CitationSources({
  text,
  context,
  finding,
  onSource,
}: {
  text: string;
  context?: string;
  /** Cited pages are being captured for passages. */
  finding?: boolean;
  onSource: (
    document: string,
    block: string,
    text: string,
    pdf?: import("../features/editor/blocksuite/pdf-highlights").PdfLocation,
    video?: VideoLocation,
    image?: import("../services/topic-types").ImageLocation,
  ) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const sources = readCitationSources(context);
  const ids = citationIds(text);
  if (!ids.length) return null;
  return (
    <details className="ask-sources">
      <summary>
        <span className="ask-source-chevron" aria-hidden="true">
          ›
        </span>
        {ids.length} {ids.length === 1 ? "source" : "sources"}
      </summary>
      {error && <p role="alert">{error}</p>}
      {ids.map((id, index) => {
        const source =
          sources.find((source) => source.citation === `[S${id}]`) ??
          (sources.every((source) => !source.citation)
            ? sources[id - 1]
            : undefined);
        // A long website passage is narrowed to the sentence the answer used.
        const sentence =
          source?.kind === "web"
            ? citedSentence(claimsFor(text, `[S${id}]`), source.text)
            : null;
        const excerpt = source?.kind === "link" ? readExcerpt(source) : null;
        // A YouTube transcript passage (current notes or workspace search).
        const video =
          source &&
          (source.kind === "video" ||
            source.kind === undefined ||
            source.kind === "note")
            ? source.video
            : undefined;
        if (source && video)
          return (
            <div key={id}>
              <div className="ask-source-title">
                <span className="ask-source-index">{index + 1}</span>
                <ShellIcon name="video" />
                <span>{source.title || "YouTube transcript"}</span>
              </div>
              <blockquote>
                <span className="ask-source-time">
                  {formatTimestamp(video.start)}
                </span>{" "}
                {source.text.replace(/^\[[\d:]+\]\s*/, "")}
              </blockquote>
              <button
                onClick={() => {
                  setError("");
                  void onSource(
                    source.document,
                    video.blockId,
                    source.text,
                    undefined,
                    video,
                  ).catch((e) => setError(String(e)));
                }}
              >
                Play from {formatTimestamp(video.start)}
              </button>
            </div>
          );
        // Text Windows OCR read from an image (workspace search, or a
        // picture in the request's own notes).
        const image =
          source &&
          (source.kind === undefined ||
            source.kind === "note" ||
            source.kind === "image")
            ? source.image
            : undefined;
        if (source && image)
          return (
            <div key={id}>
              <div className="ask-source-title">
                <span className="ask-source-index">{index + 1}</span>
                <ShellIcon name="image" />
                <span>{image.caption || "Image"}</span>
              </div>
              <small className="ask-source-note">Text read from image</small>
              <blockquote>{source.text}</blockquote>
              <button
                onClick={() => {
                  setError("");
                  void onSource(
                    source.document,
                    image.blockId,
                    source.text,
                    undefined,
                    undefined,
                    image,
                  ).catch((e) => setError(String(e)));
                }}
              >
                Open image
              </button>
            </div>
          );
        return source ? (
          <div key={id}>
            <div className="ask-source-title">
              <span className="ask-source-index">{index + 1}</span>
              <ShellIcon name={source.kind === "link" ? "globe" : "note"} />
              <span>{source.title || "Source note"}</span>
            </div>
            {"ocr" in source && source.ocr && (
              <small className="ask-source-note">
                Text read from scanned page
              </small>
            )}
            {source.kind === "web" && sentence ? (
              <>
                <blockquote>
                  {sentence.start > 0 && "… "}
                  {sentence.text}
                  {sentence.end < source.text.length && " …"}
                </blockquote>
                <details className="ask-source-passage">
                  <summary>Full passage</summary>
                  <blockquote>{source.text}</blockquote>
                </details>
              </>
            ) : excerpt ? (
              <>
                <small className="ask-source-note">
                  Matching passage from the page
                </small>
                <blockquote>
                  {excerpt.excerpt !== excerpt.passage && "… "}
                  {excerpt.excerpt}
                  {excerpt.excerpt !== excerpt.passage && " …"}
                </blockquote>
                {excerpt.excerpt !== excerpt.passage && (
                  <details className="ask-source-passage">
                    <summary>Full passage</summary>
                    <blockquote>{excerpt.passage}</blockquote>
                  </details>
                )}
              </>
            ) : (
              <>
                <blockquote>
                  {source.kind === "link" ? linkLabel(source.url) : source.text}
                </blockquote>
                {source.kind === "link" &&
                  (finding && !source.excerptState ? (
                    <small className="ask-source-note">Finding excerpt…</small>
                  ) : source.excerptState === "none" ? (
                    <small className="ask-source-note">
                      No matching passage found on the page.
                    </small>
                  ) : source.excerptState === "unavailable" ? (
                    <small className="ask-source-note">
                      The page couldn’t be read for an excerpt.
                    </small>
                  ) : null)}
              </>
            )}
            <button
              onClick={() => {
                setError("");
                void (
                  source.kind === "link"
                    ? openWebLink(
                        excerpt
                          ? passageUrl(
                              excerpt.url,
                              excerpt.excerpt,
                              excerpt.page,
                            )
                          : source.url,
                      )
                    : source.kind === "web"
                      ? openWebLink(
                          passageUrl(
                            (source.url && normalizeWebUrl(source.url)) ||
                              (retainedWebAttempts(context).find(
                                (a) =>
                                  a.capture?.captureId === source.captureId,
                              )?.capture?.finalUrl ??
                                ""),
                            sentence?.text ?? source.text,
                            source.page,
                          ),
                        )
                      : onSource(
                          source.document,
                          source.id,
                          source.text,
                          "pdf" in source ? source.pdf : undefined,
                        )
                ).catch((e) => setError(String(e)));
              }}
            >
              {excerpt
                ? "Open passage"
                : source.kind === "link"
                  ? "Open link"
                  : "Open source"}
            </button>
          </div>
        ) : (
          <small key={id}>Source {index + 1} unavailable</small>
        );
      })}
    </details>
  );
});

function WorkspaceCoverage({ context }: { context?: string }) {
  try {
    const data = JSON.parse(context ?? "{}");
    const extra = [
      data.webSearches ? "Searched the web" : "",
      data.imagesViewed?.length
        ? `Looked at ${data.imagesViewed.length} image${data.imagesViewed.length === 1 ? "" : "s"}`
        : "",
    ].filter(Boolean);
    if (extra.length && !data.workspaceSearch)
      return <small className="ask-model-notice">{extra.join(" · ")}</small>;
    if (data.workspaceSearch) {
      const { queries, coverage } = data.workspaceSearch as {
        queries: string[];
        coverage: {
          failed: number;
          indexed: number;
          total: number;
          semantic: boolean;
        };
      };
      return (
        <small className="ask-model-notice">
          Searched workspace for {queries.map((q) => `“${q}”`).join(", ")}
          {coverage.failed
            ? ` · Partial coverage (${coverage.indexed}/${coverage.total})`
            : ""}
          {!coverage.semantic ? " · Keyword search only" : ""}
          {extra.map((part) => ` · ${part}`).join("")}
        </small>
      );
    }
    if (data.sourceMode !== "workspace") return null;
    return (
      <small className="ask-model-notice">
        Workspace
        {data.coverage.failed
          ? ` · Partial coverage (${data.coverage.indexed}/${data.coverage.total})`
          : ""}
        {!data.coverage.semantic ? " · Keyword search only" : ""}
      </small>
    );
  } catch {
    return null;
  }
}
/** A message's context with the excerpts its searches found, for citations. */
function shownContext(request?: Turn["request"]): string | undefined {
  if (
    !request?.searches?.length &&
    !request?.links?.length &&
    !request?.webSearches &&
    !request?.imagesViewed?.length
  )
    return request?.context;
  try {
    const data = JSON.parse(request.context);
    const searches = request.searches ?? [];
    const found = searches.map((search) => JSON.parse(search.evidence));
    return JSON.stringify({
      ...data,
      citationSources: [
        ...(data.citationSources ?? []),
        ...found.flatMap((evidence) => evidence.citationSources ?? []),
        ...(request.links ?? []),
      ],
      workspaceSearch: searches.length
        ? {
            queries: searches.map((search) => search.query),
            coverage: found.at(-1)?.coverage,
          }
        : undefined,
      webSearches: request.webSearches,
      imagesViewed: request.imagesViewed,
    });
  } catch {
    return request.context;
  }
}
/**
 * Whether to offer web search: the message looks like it needs the web, or
 * it follows an answer that searched the web ("and for Java?").
 */
function wantsWeb(input: string, turns: Turn[]) {
  const previous = turns.at(-1);
  return (
    webIntent(input) ||
    (previous?.role === "assistant" && !!previous.request?.webSearches)
  );
}
/** A cited link without its scheme, for showing under its title. */
function linkLabel(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}
/**
 * Images view_images may show: those in the focused note or card when it has
 * any, otherwise every image in the document.
 */
function noteImages(
  session: EditorSession,
  noteId?: string | null,
): { key: string; name: string }[] {
  const all = session.imageSources?.() ?? [];
  const note = noteId ? session.doc.getBlock?.(noteId)?.model : undefined;
  if (!note) return all;
  const keys = new Set<string>();
  const walk = (model: { children: unknown[]; sourceId?: string }) => {
    if (model.sourceId) keys.add(model.sourceId);
    for (const child of model.children)
      walk(child as { children: unknown[]; sourceId?: string });
  };
  walk(note as unknown as { children: unknown[]; sourceId?: string });
  const inNote = all.filter((image) => keys.has(image.key));
  return inNote.length ? inNote : all;
}
/** The highest citation number used so far, so new excerpts continue it. */
function lastCitation(
  context: string,
  searches: { evidence: string }[],
): number {
  const numbers = [context, ...searches.map((search) => search.evidence)]
    .flatMap((text) => readCitationSources(text))
    .map((source) =>
      Number(/^\[S(\d+)\]$/.exec(source.citation ?? "")?.[1] ?? 0),
    );
  return Math.max(0, ...numbers);
}
/** Adds one request's cost to a message that made several. */
function addCost(a: AiCost, b: AiCost): AiCost {
  const sum = (x: number | null, y: number | null) =>
    x === null || y === null ? null : x + y;
  return {
    usd: sum(a.usd, b.usd),
    input: sum(a.input, b.input),
    cached: sum(a.cached, b.cached),
    output: sum(a.output, b.output),
    reasoning: sum(a.reasoning, b.reasoning),
    tier: a.tier === b.tier ? a.tier : null,
    pricing: b.pricing,
    web_searches: (a.web_searches ?? 0) + (b.web_searches ?? 0),
  };
}
function citationIds(text: string) {
  return [
    ...new Set(
      [...text.matchAll(/\[S(\d+)\]/g)].map((match) => Number(match[1])),
    ),
  ];
}
