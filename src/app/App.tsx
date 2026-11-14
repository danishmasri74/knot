import type { McqEditRequest } from "../features/editor/blocksuite/mcq-block";
import { restoreMcqTarget, type McqInsertionTarget } from "../features/editor/blocksuite/mcq-insertion";
import type { NewMcqRequest } from "../features/editor/blocksuite/mcq-menu";
import { LinksPanel, type LinksView } from "./LinksPanel";
import { dismissLaunchSplash } from "../services/launch";
import { createPortal } from "react-dom";
import { findCardPlacement } from "../services/topic-card-location";
import {
  getNoteView,
  setNoteView,
  type NoteView,
} from "../services/note-navigation";
import {
  extractTopicContent,
  extractDeckPassages,
} from "../services/topic-extract";
import { cardMcq, cardPreview, type DeckData } from "../features/editor/blocksuite/card-deck";
import { McqComposer } from "./McqComposer";
import type { McqDefinition } from "../features/quiz/mcq";
import type { ImageLocation } from "../services/topic-types";
import { configureOcr, startTopicIndex } from "../services/workspace-topic";
import {
  OCR_CHANGED,
  WORKSPACE_SEARCH_CHANGED,
} from "../services/ai-preferences";
import { ColumnVisibilityToggle, WorkspacePanes } from "./WorkspacePanes";
import { useNotebookLayout } from "./useNotebookLayout";
import { NotePagePane } from "./NotePagePane";
import {
  supportingKinds,
  tabIdentity,
  type PaneKind,
  type PaneTab,
  type LayoutAction,
} from "./workspace-layout";
import { observeNotePaneToolbar } from "../features/editor/blocksuite/note-pane-toolbar";
import { waitForEditorView } from "./view-readiness";
import { BrowserPanel } from "./BrowserPanel";
import { CardEditDialog } from "./CardEditDialog";
import type { CardEditRequest } from "../features/editor/blocksuite/card-embed";
import { VideoResume } from "./ResumeCard";
import {
  browserApi,
  getBrowserWidth,
  type BrowserRequest,
} from "../services/browser";
import {
  getLinkPreference,
  setLinkPreference,
  installWebLinkRouter,
  type LinkPreference,
} from "../services/web-links";
import { parsePdfSourceUrl } from "../features/editor/blocksuite/pdf-highlights";
import { installYoutubeToolbars } from "../features/editor/blocksuite/youtube-toolbar";
import type {
  VideoLocation,
  VideoSource,
} from "../services/youtube-transcript";
import { ViewTransition } from "./ViewTransition";
import { CanvasSuggestions } from "./CanvasSuggestions";
import {
  qualifiedActions,
  type CardAction,
} from "../features/editor/blocksuite/card-suggestions";
import { CardDeckPanel } from "./CardDeckPanel";
import { structuredAiBlocks } from "../features/editor/blocksuite/ai";
import { savedSearchText } from "../features/editor/blocksuite/search";
import { Notice } from "./Notice";
import { AddNotePicker } from "./AddNotePicker";
import { observeAiToolbar } from "../features/editor/blocksuite/ai-toolbar";
import { LibraryPage, type LibraryLocation } from "./LibraryPage";
import { LibraryCardDeck } from "./LibraryCardDeck";
import { useSidebarDrag, reorderedCollections } from "./useSidebarDrag";
import { Favorites } from "./Favorites";
import { Mascot } from "./Mascot";
import { NewNotebook } from "./NewNotebook";
import { AiSettings } from "./AiSettings";
import { UpdatesSettings } from "./UpdatesSettings";
import { ShareNotebookDialog } from "./ShareNotebookDialog";
import { ImportNotebookDialog } from "./ImportNotebookDialog";
import { setUnsharedTitles } from "../features/editor/blocksuite/unshared";
import {
  checkForUpdate,
  getUpdateState,
  installUpdate,
  launchReport,
  shouldAnnounce,
  skippedVersion,
  useUpdateState,
} from "../services/updater";
import { getAiEnabled } from "../services/ai-preferences";
import { AskKnot } from "./AskKnot";
import { flushChatSaves } from "../services/ai-chats";
import {
  captureAiContext,
  captureCardContext,
  type AiContext,
} from "../features/editor/blocksuite/ai";
import {
  carrySidebarPreferences,
  expandedPlace,
  orderedFavorites,
  useSidebarPreferences,
} from "./useSidebarPreferences";
import { CanvasRecovery } from "./CanvasRecovery";
import {
  createGettingStarted,
  tourStatus,
  type TourStatus,
} from "../features/getting-started";
import { EditorSettings } from "./EditorSettings";
import {
  getAppearance,
  setAppearance,
  type Appearance,
} from "../services/appearance";
import { TrashPage } from "./TrashPage";
import { SidebarFrame } from "./SidebarFrame";
import { Disclosure } from "./Disclosure";
import {
  ToolSurface,
  managementSurfaces,
  type SurfaceKind,
  surfaceTitles,
} from "./ToolSurface";
import { ShellMenu } from "./ShellMenu";
import { ShellIcon } from "./ShellIcon";
import { NoteCrumb } from "./NoteCrumb";
import { AnimatedTrash } from "./AnimatedTrash";
import { AnimatedFavorite } from "./AnimatedFavorite";
import { NotebookContents } from "./NotebookContents";
import { GlobalSearch } from "./GlobalSearch";
import { isSearchResultOnPage } from "../features/editor/blocksuite/search-reveal";
import { TrashConfirmation } from "./TrashConfirmation";
import {
  searchSavedDocuments,
  type SearchContent,
  type SearchReport,
} from "../features/editor/blocksuite/search";
import { BackupManager } from "./BackupManager";
import { lazy, Suspense } from "react";
import type {
  PdfLocation,
  PdfSource,
} from "../features/editor/blocksuite/pdf-highlights";
const PdfReader = lazy(() =>
  import("./PdfReader").then((module) => ({ default: module.PdfReader })),
);
const VideoReader = lazy(() =>
  import("./VideoReader").then((module) => ({ default: module.VideoReader })),
);
import { BacklinksPanel } from "./BacklinksPanel";
import {
  findBacklinks,
  type BacklinkReport,
} from "../features/editor/blocksuite/backlinks";
import { IntegrityPanel } from "./IntegrityPanel";
import { QuarantinePanel } from "./QuarantinePanel";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { flushUiPreferences } from "../services/ui-preferences";
import { listen } from "@tauri-apps/api/event";
import {
  repository,
  attachments,
  quarantine,
  type OrphanCandidate,
  type QuarantineCatalog,
  backups,
  workspaces,
  knotbooks,
  type WorkspaceCatalog,
  type IntegrityReport,
  type BackupEntry,
  exportDocument,
  type ExportFormat,
  collections,
  type Catalog,
  type KnowledgeObject,
  type TrashedObject,
} from "../services/workspace";
import type { SaveStatus } from "../services/persistence";
import { WorkspacePicker, workspaceName } from "./WorkspacePicker";
import { NavigationHistory } from "../services/navigation";
import {
  CollectionGroup,
  CollectionMembership,
  CreateCollection,
} from "./Collections";
import {
  openEditor,
  type EditorSession,
} from "../features/editor/blocksuite/adapter";

const defaultLibrary: LibraryLocation = {
  id: "library:notebooks",
  library: "notebooks",
};

/** Briefly marks OCR line boxes (image fractions) over an image, once its
 * position has been stable for a few frames (at most about two seconds). */
async function highlightImageLines(
  picture: HTMLImageElement,
  rects: [number, number, number, number][],
) {
  let last = "",
    stable = 0;
  for (let frame = 0; frame < 150 && stable < 8; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!picture.isConnected) return;
    const b = picture.getBoundingClientRect();
    const key = [b.left, b.top, b.width, b.height].map(Math.round).join();
    stable = key === last && b.width > 0 ? stable + 1 : 0;
    last = key;
  }
  if (stable < 8) return;
  const box = picture.getBoundingClientRect();
  for (const [x, y, w, h] of rects.slice(0, 100)) {
    const mark = document.createElement("div");
    mark.className = "ocr-line-highlight";
    Object.assign(mark.style, {
      left: `${box.left + x * box.width}px`,
      top: `${box.top + y * box.height}px`,
      width: `${w * box.width}px`,
      height: `${h * box.height}px`,
    });
    document.body.append(mark);
    mark
      .animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], {
        duration: 2600,
      })
      .finished.finally(() => mark.remove());
  }
}
export function App() {
  const [library, setLibrary] = useState<LibraryLocation | null>(
    defaultLibrary,
  );
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [mcqComposer, setMcqComposer] = useState<{
    cardId?: string;
    notebookId?: string;
    owner: EditorSession;
    target?: McqInsertionTarget;
    initial?: McqDefinition;
    source?: McqDefinition["sources"][number];
  }>();
  const flushMcqDraft = useRef<(() => Promise<void>) | undefined>();
  // Saves everything a window close would lose. Shared by closing Knot and by
  // installing an update, which exits the app as soon as the installer starts.
  const flushPendingWork = async () => {
    await flushMcqDraft.current?.();
    await session.current?.flush();
    await flushChatSaves();
  };
  const prepareToClose = useRef(async () => {
    await flushPendingWork();
    await flushUiPreferences();
    // Best effort: destroying the window tears the browser pane down anyway,
    // and a broken pane must not keep Knot from closing once edits are saved.
    await browserApi.dispose().catch((e) =>
      console.warn("Browser pane cleanup failed during close", e),
    );
  });
  const [quizReset, setQuizReset] = useState(false);
  const [sharing, setSharing] = useState<{ id: string; title: string } | null>(null);
  // A .knotbook waiting to be imported, by opaque token (paths stay native).
  const [importToken, setImportToken] = useState<string | null>(null);
  const [aiPlacement, setAiPlacement] = useState<"page" | "panel" | "hidden">(
    "hidden",
  );
  const [aiOpened, setAiOpened] = useState(false);
  const [aiContainer] = useState(() => {
    const node = document.createElement("div");
    node.className = "ask-live-session";
    return node;
  });
  const aiPageHost = useRef<HTMLDivElement>(null);
  function showAi(placement: "page" | "panel", record = true) {
    setAiOpened(true);
    setAiPlacement(placement);
    if (placement === "panel") {
      setLibrary(null);
      openPane("ask");
    } else {
      for (const tab of Object.values(layoutRef.current.tabs))
        if (tab.kind === "ask") dispatchLayout({ type: "close", id: tab.id });
    }
    setSurface(null);
    if (placement === "page" && record)
      history.current.visit({ id: "ask-knot", ai: true });
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>(".ask-knot textarea")
        ?.focus(),
    );
  }

  const [aiEnabled] = useState(getAiEnabled);
  const [aiContext, setAiContext] = useState<AiContext | null>(null);
  const [suggestion, setSuggestion] = useState<{
    context: AiContext;
    action: CardAction;
  } | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [tour, setTour] = useState<TourStatus | null>(null);
  const [appearance, updateAppearance] = useState(getAppearance);
  const [moveSelection, setMoveSelection] = useState<KnowledgeObject | null>(
    null,
  );
  const [trashIcon, setTrashIcon] = useState<"notebook" | "folder">("notebook");
  const [collectionTrash, setCollectionTrash] = useState<string | null>(null);
  const trashOrigin = useRef<"sidebar" | "toolbar" | "drop">("sidebar");
  const [trashAnimation, setTrashAnimation] = useState({
    sidebar: 0,
    toolbar: 0,
    dropped: false,
  });
  // Shared by the sidebar's and the Library's notebook menus.
  async function renameNotebook(item: KnowledgeObject, name: string) {
    await session.current?.flush();
    if (session.current?.doc.id === item.id) {
      await session.current.rename(name);
      setTitle(name);
      setActive((current) =>
        current?.id === item.id ? { ...current, title: name } : current,
      );
    } else await repository.rename(item.id, name);
    history.current.update(item.id, { title: name });
    await refresh();
    await reloadCollections();
    setLibraryRevision((value) => value + 1);
  }
  function requestTrash(
    item: KnowledgeObject,
    origin: "sidebar" | "toolbar" | "drop" = "sidebar",
  ) {
    trashOrigin.current = origin;
    setMoveSelection(item);
  }
  async function animateTrashDrop(
    item: "notebook" | "folder",
    closeConfirmation: () => void,
  ) {
    // Finish the editor/sidebar refresh before starting visible feedback.
    // Keep the confirmation and open lid in place through that work.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    setTrashIcon(item);
    setTrashAnimation((value) => ({
      ...value,
      sidebar: value.sidebar + 1,
      dropped: true,
    }));
    closeConfirmation();
  }
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("knot.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("knot.sidebar.collapsed", String(collapsed));
    } catch {
      /* Optional UI preference. */
    }
  }, [collapsed]);
  const [navigating, setNavigating] = useState(false);
  const navigationRunning = useRef(false);
  const pendingNavigation = useRef<{
    task: () => Promise<void>;
    resolve: () => void;
  } | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [editorLoadFailed, setEditorLoadFailed] = useState(false);
  const [transition, setTransition] = useState<{
    view: "page" | "edgeless";
    done: boolean;
  } | null>(null);
  const [focusedNote, setFocusedNote] = useState<string | null>(null);
  const [foldingNotes, setFoldingNotes] = useState<
    Record<string, ReturnType<EditorSession["notebookNotes"]>>
  >({});
  const [collapsedNotebook, setCollapsedNotebook] = useState<string | null>(
    null,
  );
  // The sidebar place (Favorites, Recently visited or a pinned collection)
  // the open notebook was last opened from; only that copy expands.
  const [notebookPlace, setNotebookPlace] = useState<string | null>(null);
  const focusedEditor = useRef<EditorSession["editor"] | null>(null);
  const [documentUndo, setDocumentUndo] = useState(true);
  useEffect(() => {
    const track = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const kind =
        target.closest<HTMLElement>("[data-pane-kind]")?.dataset.paneKind;
      if (kind === "browser" || kind === "pdf" || kind === "video")
        setDocumentUndo(false);
      else if (kind === "note") setDocumentUndo(true);
      const editor = target.closest<EditorSession["editor"]>(
        "affine-editor-container",
      );
      if (editor) {
        focusedEditor.current = editor;
        setDocumentUndo(true);
      } else if (
        target.closest(
          ".pane-browser, .pane-pdf, .video-reader, .ask-knot, input, textarea, dialog",
        )
      )
        setDocumentUndo(false);
    };
    document.addEventListener("focusin", track);
    document.addEventListener("pointerdown", track, true);
    return () => {
      document.removeEventListener("focusin", track);
      document.removeEventListener("pointerdown", track, true);
    };
  }, []);
  const pendingPaneFocus = useRef<string | null>(null);
  const workspaceIdentity = useRef<string | null>(null);
  const contentArea = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(1000);
  const [, refreshPaneLabels] = useState(0);
  useLayoutEffect(() => {
    const node = contentArea.current;
    if (!node) return;
    const measure = () => {
      // Keep the pane projection stable while the Library hides the notebook.
      if (node.clientWidth > 0) setContentWidth(node.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);
  function openPane(kind: PaneKind, noteId?: string, beside?: string) {
    if (kind === "ask") {
      setAiOpened(true);
      setAiPlacement("panel");
      setLibrary(null);
    }
    const documentId =
      kind === "browser" || kind === "cardDeck"
        ? undefined
        : session.current?.doc.id;
    const tab = {
      kind,
      workspaceId: workspaceIdentity.current ?? "",
      documentId,
      noteId,
    };
    const id = tabIdentity(tab);
    dispatchLayout({
      type: "open",
      tab: { ...tab, id },
      beside,
      width:
        layoutRef.current.groups.find(
          (g) => g.id === layoutRef.current.lastUsedGroupId,
        )?.preferredWidth ??
        (kind === "browser" ? getBrowserWidth() : kind === "pdf" ? 640 : 480),
    });
    pendingPaneFocus.current = id;
  }
  const paneActive = (kind: PaneKind) =>
    !layout.hidden &&
    layout.groups.some((g) => layout.tabs[g.activeTabId]?.kind === kind);
  function dispatchPaneAction(action: LayoutAction) {
    if (
      action.type === "close" &&
      layoutRef.current.tabs[action.id]?.kind === "ask"
    )
      setAiPlacement("hidden");
    if (
      action.type === "close" &&
      layoutRef.current.tabs[action.id]?.kind === "pdf"
    )
      setPdfReader(null);
    if (
      action.type === "close" &&
      layoutRef.current.tabs[action.id]?.kind === "video"
    )
      setVideoReader(null);
    dispatchLayout(action);
  }
  const closePane = (id: string) => dispatchPaneAction({ type: "close", id });
  const [surface, setSurface] = useState<SurfaceKind | null>(null);
  const [browserRequest, setBrowserRequest] = useState<BrowserRequest | null>(
    null,
  );
  const browserSequence = useRef(0);
  const [browserExpanded, setBrowserExpanded] = useState(false);
  const [linkPreference, updateLinkPreference] = useState(getLinkPreference);
  const [noteView, updateNoteView] = useState(getNoteView);
  useEffect(() => {
    if (!isTauri()) return;
    const off = listen<string>("browser-cleanup-error", (event) =>
      setError(event.payload),
    );
    return () => {
      void off.then((fn) => fn());
    };
  }, []);
  function navigateBrowser(url: string) {
    setBrowserRequest({ key: ++browserSequence.current, url });
    openSurface("browser");
  }
  useEffect(
    () =>
      installWebLinkRouter((url, reserved) => {
        if (reserved) {
          try {
            const location = parsePdfSourceUrl(url);
            if (!location)
              throw new Error("This internal link is unavailable.");
            void openPdf(location).catch(report);
          } catch (e) {
            report(e);
          }
        } else if (getLinkPreference() === "external")
          void browserApi.external(url).catch(report);
        else navigateBrowser(url);
      }),
    [],
  );

  const [panelWidth, setPanelWidth] = useState(400);
  const activePanelWidth = panelWidth;
  const invoker = useRef<HTMLElement | null>(null);
  function clearInactiveSurface(next: SurfaceKind | null) {
    if (next !== "integrity") setIntegrity(null);
    if (next !== "quarantine") setCleanup(null);
    if (next !== "trash") setTrash(null);
    if (next !== "backups") setBackupEntries(null);
  }
  function openSurface(next: SurfaceKind, beside?: string) {
    clearInactiveSurface(next);
    const focused = document.activeElement as HTMLElement | null;
    if (
      focused &&
      focused !== document.body &&
      !focused.closest(".tool-surface")
    )
      invoker.current =
        focused?.closest("details")?.querySelector("summary") ?? focused;
    if (supportingKinds.has(next)) {
      setSurface(null);
      openPane(next as PaneKind, undefined, beside);
    } else setSurface(next);
  }
  function closeSurface() {
    clearInactiveSurface(null);
    setSurface(null);
    requestAnimationFrame(() => {
      if (invoker.current?.isConnected) invoker.current.focus();
      else
        document.querySelector<HTMLElement>(".document-menu summary")?.focus();
    });
  }
  function toggleSurface(kind: SurfaceKind, visible: boolean) {
    if (visible) openSurface(kind);
    else if (!supportingKinds.has(kind))
      setSurface((current) => (current === kind ? null : current));
  }
  const [showSearch, setShowSearch] = useState(false);
  const searchInsertion = useRef<McqInsertionTarget | undefined>(undefined);
  // A card shown inside a note, open for editing ("Edit card").
  const [cardEdit, setCardEdit] = useState<string | null>(null);
  useEffect(() => {
    const edit = (event: Event) => {
      const { cardId } = (event as CustomEvent<CardEditRequest>).detail;
      const card = session.current?.cardDeck.data[cardId];
      if (card && !card.deleted) setCardEdit(cardId);
    };
    window.addEventListener("knot-edit-card", edit);
    return () => window.removeEventListener("knot-edit-card", edit);
  }, []);
  async function scanSearch(searchQuery: string, signal: AbortSignal) {
    await session.current?.flush();
    const deck = JSON.parse(await repository.loadCardDeck()) as DeckData;
    let worker: Worker | undefined;
    try {
      return await searchSavedDocuments(
        searchQuery,
        (offset) => {
          signal.throwIfAborted();
          return repository.list("", offset, { collection: null });
        },
        (id) => {
          signal.throwIfAborted();
          return repository.load(id);
        },
        (id, snapshot) =>
          new Promise<SearchContent>((resolve, reject) => {
            const initial = !worker;
            worker ??= new Worker(
              new URL(
                "../features/editor/blocksuite/search.worker.ts",
                import.meta.url,
              ),
              { type: "module" },
            );
            const fail = () => {
              clearTimeout(timer);
              worker?.terminate();
              worker = undefined;
              reject(new Error("Search decoding failed or timed out"));
            };
            const timer = setTimeout(fail, 5000);
            worker.onerror = fail;
            worker.onmessage = (
              event: MessageEvent<{ content?: SearchContent; error?: string }>,
            ) => {
              clearTimeout(timer);
              if (event.data.error) reject(new Error(event.data.error));
              else resolve(event.data.content ?? { text: "", notes: [] });
            };
            worker.postMessage({ id, snapshot, ...(initial ? { deck } : {}) });
          }),
      );
    } finally {
      worker?.terminate();
    }
  }
  /** Library search matches in text OCR read from images and scanned pages. */
  async function ocrSearch(searchQuery: string): Promise<SearchReport["results"]> {
    if (!isTauri()) return [];
    const { activation } = await invoke<{ activation: string }>("topic_catalog");
    const matches = await invoke<
      {
        document: string;
        key: string;
        page: number;
        block: string;
        name: string;
        excerpt: string;
        rects: [number, number, number, number][];
      }[]
    >("ocr_search", { activation, query: searchQuery });
    if (!matches.length) return [];
    const catalog = await repository.catalog();
    // Card Deck cards are listed under the notebook or canvas they sit on.
    const owners = new Map<string, KnowledgeObject | undefined>();
    for (const match of matches)
      if (match.document.startsWith("deck:") && !owners.has(match.document))
        owners.set(
          match.document,
          (await cardPlacement(match.document.slice(5)).catch(() => null))?.owner,
        );
    return matches.flatMap((match) => {
      const source = match.document.startsWith("deck:")
        ? owners.get(match.document)
        : catalog.find((item) => item.id === match.document);
      if (!source || !match.block) return [];
      return [
        match.page
          ? {
              source,
              noteTitle: `${match.name || "PDF"} · p. ${match.page}`,
              excerpt: `Text in scan: ${match.excerpt}`,
              pdf: {
                key: match.key,
                name: match.name || "PDF",
                documentId: match.document,
                blockId: match.block,
                page: match.page,
                rects: match.rects,
              },
            }
          : {
              source,
              noteTitle: match.name || "Image",
              excerpt: `Text in image: ${match.excerpt}`,
              image: {
                key: match.key,
                documentId: match.document,
                blockId: match.block,
                rects: match.rects,
              },
            },
      ];
    });
  }
  const [citedDeckSource, setCitedDeckSource] = useState<{
    workspace: string;
    id: string;
    text: string;
  }>();
  const [pdfReader, setPdfReader] = useState<{
    sources: PdfSource[];
    initial?: PdfLocation;
    id: string;
  } | null>(null);
  async function openPdf(location?: PdfLocation) {
    const current = session.current;
    await current?.flush();
    if (current !== session.current) return;
    const sources = current?.pdfSources() ?? [];
    if (location && !sources.some((entry) => entry.key === location.key))
      sources.push(location);

    setPdfReader((previous) =>
      previous && !location
        ? { ...previous, sources }
        : {
            sources,
            initial: location,
            id: previous?.id ?? crypto.randomUUID(),
          },
    );
    openSurface("pdf");
  }
  // The YouTube side panel (docs/YOUTUBE-TRANSCRIPT-PLAN.md): one video at a
  // time, opened from a card's toolbar. Pressing the button again closes it.
  const [videoReader, setVideoReader] = useState<VideoSource | null>(null);
  const [videoSeek, setVideoSeek] = useState<{ ms: number; nonce: number }>();
  /** Open a cited transcript moment: that video, playing from `start`. */
  function openVideoAt(location: VideoLocation) {
    setVideoReader((current) =>
      current?.videoId === location.videoId
        ? current
        : {
            videoId: location.videoId,
            title: location.title,
            url: `https://www.youtube.com/watch?v=${location.videoId}`,
            documentId: location.documentId,
            blockId: location.blockId,
          },
    );
    setVideoSeek({ ms: location.start, nonce: Date.now() });
    openSurface("video");
  }
  const videoState = useRef(videoReader);
  videoState.current = videoReader;
  // Read the layout at call time; `layout` is declared further down.
  const videoShown = (videoId: string) => {
    const current = layoutRef.current;
    return (
      videoState.current?.videoId === videoId &&
      !current.hidden &&
      current.groups.some((g) => current.tabs[g.activeTabId]?.kind === "video")
    );
  };
  const toggleVideo = useRef((source: VideoSource) => {
    if (videoShown(source.videoId)) {
      const tab = Object.values(layoutRef.current.tabs).find(
        (entry) => entry.kind === "video",
      );
      if (tab) closePane(tab.id);
      return;
    }
    setVideoReader(source);
    setVideoSeek(undefined);
    openSurface("video");
  });
  const youtubeToolbars = useRef<ReturnType<
    typeof installYoutubeToolbars
  > | null>(null);
  useEffect(() => {
    const controller = installYoutubeToolbars(
      (source) => toggleVideo.current(source),
      (videoId) => videoShown(videoId),
    );
    youtubeToolbars.current = controller;
    return () => {
      controller.dispose();
      youtubeToolbars.current = null;
    };
  }, []);
  useEffect(() => {
    youtubeToolbars.current?.refresh();
  });
  const [linksView, setLinksView] = useState<LinksView>("add");
  const [backlinks, setBacklinks] = useState<BacklinkReport | null>(null);
  async function scanBacklinks() {
    setBacklinks(null);
    await session.current?.flush();
    if (active)
      setBacklinks(
        await findBacklinks(
          active.id,
          await repository.catalog(),
          repository.load,
        ),
      );
  }
  const [cleanup, setCleanup] = useState<{
    candidates: OrphanCandidate[] | null;
    catalog: QuarantineCatalog;
  } | null>(null);
  const [cleanupVersion, setCleanupVersion] = useState(0);
  async function loadCleanup() {
    openSurface("quarantine");
    setCleanupVersion((v) => v + 1);
    setCleanup({ candidates: null, catalog: { entries: [], warnings: [] } });
    const catalog = await quarantine.catalog();
    setCleanup({ candidates: null, catalog });
    const candidates = await quarantine.preview();
    setCleanup({ candidates, catalog });
  }
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  async function checkWorkspace() {
    openSurface("integrity");
    setIntegrity(null);
    await session.current?.flush();
    setIntegrity(await repository.integrity());
  }
  async function restoreDocument(
    item: { id: string; title: string },
    auditAfter = surface === "integrity",
  ) {
    await session.current?.flush();
    await repository.restore(item.id);
    setIntegrity(null);
    setNotice(`Restored “${item.title}”. It is available in your library.`);
    try {
      if (trash !== null) await loadTrash();
      await refresh();
      if (active) await select(active, false);
    } finally {
      if (auditAfter) await checkWorkspace();
    }
  }
  async function restoreReferenceTarget(id: string) {
    await session.current?.flush();
    setIntegrity(null);
    const latest = await repository.integrity();
    setIntegrity(latest);
    const target = latest.documents.recoverableTargets.find(
      (entry) => entry.id === id,
    );
    if (!target)
      throw new Error(
        "This target is no longer eligible for direct recovery. Review the refreshed report or open Trash & recovery.",
      );
    await restoreDocument(target, true);
  }
  const exporting = surface === "export";
  const setExporting = (value: boolean) => toggleSurface("export", value);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [workspaceCatalog, setWorkspaceCatalog] = useState<WorkspaceCatalog>({
    active: null,
    entries: [],
  });
  useEffect(() => {
    let stop = startTopicIndex();
    const changed = () => {
      stop?.();
      stop = startTopicIndex();
    };
    window.addEventListener(WORKSPACE_SEARCH_CHANGED, changed);
    window.addEventListener(OCR_CHANGED, configureOcr);
    return () => {
      stop?.();
      window.removeEventListener(WORKSPACE_SEARCH_CHANGED, changed);
      window.removeEventListener(OCR_CHANGED, configureOcr);
    };
  }, [workspaceCatalog.active, aiEnabled]);
  workspaceIdentity.current = workspaceCatalog.active;
  const [backupEntries, setBackupEntries] = useState<BackupEntry[] | null>(
    null,
  );
  const pickingWorkspace = surface === "workspace";
  const setPickingWorkspace = (value: boolean) =>
    toggleSurface("workspace", value);
  const [collectionUndo, setCollectionUndo] = useState<{
    id: string;
    collection: string;
  } | null>(null);
  const [catalog, setCatalog] = useState<Catalog>({
    collections: [],
    favorites: [],
  });
  const [trash, setTrash] = useState<TrashedObject[] | null>(null);
  const [purgeSelection, setPurgeSelection] = useState<{
    ids: string[];
    cards?: string[];
    title: string;
  } | null>(null);
  async function prepareEmptyTrash() {
    const ids: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const rows = await repository.trash("", offset);
      ids.push(...rows.map((item) => item.id));
      if (rows.length < 100) break;
    }
    const cards = (session.current?.cardDeck.trashed() ?? []).map((card) => card.id);
    const total = ids.length + cards.length;
    if (total)
      setPurgeSelection({ ids, cards, title: `Empty Trash? (${total})` });
    else {
      await loadTrash();
      setNotice("Trash is already empty.");
    }
  }
  const [trashQuery, setTrashQuery] = useState("");
  const [trashSearch, setTrashSearch] = useState("");
  const [moreTrash, setMoreTrash] = useState(false);
  const trashRequest = useRef(0);
  async function loadTrash(search = trashQuery, append = false) {
    openSurface("trash");
    const request = ++trashRequest.current;
    const rows = await repository.trash(
      search,
      append ? (trash?.length ?? 0) : 0,
    );
    if (request !== trashRequest.current) return;
    setTrash(append ? [...(trash ?? []), ...rows] : rows);
    setTrashSearch(search);
    setMoreTrash(rows.length === 100);
  }
  const [references, setReferences] = useState<KnowledgeObject[]>([]);
  const [items, setItems] = useState<KnowledgeObject[]>([]),
    [active, setActive] = useState<KnowledgeObject | null>(null),
    [query, setQuery] = useState(""),
    [mode, setMode] = useState<"page" | "edgeless">("page"),
    [status, setStatus] = useState<SaveStatus>("saved"),
    [error, setError] = useState(""),
    [notice, updateNoticeText] = useState(""),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState("");
  const citationContinuation = useRef<{
    workspace: string;
    notebook: string;
  } | null>(null);
  const [layout, dispatchLayout] = useNotebookLayout(
    workspaceCatalog.active,
    active?.id,
    citationContinuation,
  );
  const aiWorkspace = useRef(workspaceCatalog.active);
  if (aiWorkspace.current !== workspaceCatalog.active) {
    aiWorkspace.current = workspaceCatalog.active;
    let restored: "page" | "panel" | "hidden" = "hidden";
    try {
      const saved = localStorage.getItem(
        `knot.ai.placement.v1:${workspaceCatalog.active}`,
      );
      if (saved === "page" || saved === "panel") restored = saved;
    } catch {
      /* Preferences are optional. */
    }
    setAiPlacement(restored);
    setAiOpened(restored !== "hidden");
  }
  useEffect(() => {
    if (!workspaceCatalog.active) return;
    try {
      localStorage.setItem(
        `knot.ai.placement.v1:${workspaceCatalog.active}`,
        aiPlacement,
      );
    } catch {
      /* Keep the live view usable. */
    }
  }, [workspaceCatalog.active, aiPlacement]);
  useLayoutEffect(() => {
    const ask = Object.values(layout.tabs).find((tab) => tab.kind === "ask");
    if (ask && aiPlacement !== "page") {
      setAiOpened(true);
      setAiPlacement("panel");
    }
    if (!ask && aiPlacement === "panel") {
      openPane("ask");
      return;
    }
    const slot = ask
      ? document.getElementById(`panel-${encodeURIComponent(ask.id)}`)
      : null;
    const target = aiPlacement === "panel" && slot ? slot : aiPageHost.current;
    if (target && aiContainer.parentElement !== target)
      target.appendChild(aiContainer);
    const main = contentArea.current?.parentElement;
    if (main)
      for (const node of main.querySelectorAll<HTMLElement>(
        ":scope > .workspace-content, :scope > .library-page",
      ))
        node.inert = aiPlacement === "page";
  }, [layout, aiPlacement, aiContainer, library, aiOpened]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [noticeRevision, setNoticeRevision] = useState(0);
  const updateNotice = (value: string) => {
    updateNoticeText(value);
    setNoticeRevision((revision) => revision + 1);
  };
  // An optional action button for the current notice (e.g. "View" an update).
  const [noticeAction, setNoticeAction] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const setNotice = (value: string) => {
    setCollectionUndo(null);
    setNoticeAction(null);
    updateNotice(value);
  };
  const showNotice = (value: string, action: { label: string; run: () => void }) => {
    setNotice(value);
    setNoticeAction(action);
  };
  const updateState = useUpdateState();
  // The quiet Settings dot: an update is waiting and the Updates page hasn't
  // been opened for that version yet.
  const [seenUpdate, setSeenUpdate] = useState("");
  const pendingUpdateVersion =
    updateState.kind === "available" || updateState.kind === "ready"
      ? updateState.version
      : "";
  const updateDot =
    !!pendingUpdateVersion &&
    pendingUpdateVersion !== seenUpdate &&
    pendingUpdateVersion !== skippedVersion();
  const host = useRef<HTMLDivElement>(null),
    history = useRef(
      new NavigationHistory<
        KnowledgeObject | LibraryLocation | { id: string; ai: true }
      >(),
    ),
    session = useRef<EditorSession | null>(null),
    locked = useRef(false),
    file = useRef<HTMLInputElement>(null),
    searchGeneration = useRef(0);
  useSyncExternalStore(history.current.subscribe, history.current.getSnapshot);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const report = (e: unknown) => setError(String(e));
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let running = false;
    const cleanup = async () => {
      if (running) return;
      running = true;
      try {
        const count = await repository.clearExpiredTrash();
        if (count && !stopped) {
          setTrash(
            (rows) =>
              rows?.filter(
                (row) => row.deleted_at > Date.now() - 30 * 24 * 60 * 60 * 1000,
              ) ?? null,
          );
        }
      } catch (error) {
        if (!stopped)
          setError(`Automatic Trash cleanup failed: ${String(error)}`);
      } finally {
        running = false;
      }
    };
    void cleanup();
    const timer = window.setInterval(() => void cleanup(), 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  async function importFiles(
    files: File[],
    point?: { x: number; y: number; afterId?: string },
  ) {
    const target = session.current;
    if (!target)
      throw new Error("Open a note or whiteboard before adding files.");
    const failures: string[] = [];
    let imported = 0;
    let afterId = point?.afterId;
    for (const [index, selected] of files.entries()) {
      try {
        const inserted = await target.insert(
          selected,
          point
            ? { x: point.x + index * 24, y: point.y + index * 24, afterId }
            : undefined,
        );
        if (target.editor.mode === "page") afterId = inserted;
        imported++;
      } catch (cause) {
        failures.push(String(cause));
      }
    }
    if (imported)
      setNotice(`Added ${imported} ${imported === 1 ? "file" : "files"}.`);
    if (failures.length) throw new Error(failures.join("\n"));
  }
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);
  useLayoutEffect(() => {
    const wasLocked = host.current?.inert;
    if (host.current)
      host.current.inert =
        busy ||
        navigating ||
        documentLoading ||
        !!transition ||
        editorLoadFailed ||
        !!library ||
        !!(surface && managementSurfaces.has(surface));
    if (
      wasLocked &&
      host.current &&
      !host.current.inert &&
      session.current?.editor.mode === "edgeless"
    )
      performance.mark("knot:canvas-input-unlocked");
  }, [
    busy,
    navigating,
    documentLoading,
    transition,
    editorLoadFailed,
    surface,
    library,
  ]);
  useEffect(() => {
    pendingPaneFocus.current = null;
    setBrowserExpanded(false);
    setBrowserRequest(null);
    setSuggestion(null);
    const current = session.current;
    if (!current) return;
    let labelTimer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => refreshPaneLabels((n) => n + 1), 120);
    };
    current.doc.spaceDoc.on("update", refresh);
    const off = observeNotePaneToolbar(current.editor, (id) => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) invoker.current = focused;
      openPane("note", id);
    });
    return () => {
      clearTimeout(labelTimer);
      off();
      current.doc.spaceDoc.off("update", refresh);
    };
  }, [active?.id, workspaceCatalog.active]);
  useEffect(() => {
    if (
      busy ||
      navigating ||
      documentLoading ||
      surface ||
      !pendingPaneFocus.current
    )
      return;
    const frame = requestAnimationFrame(() => {
      const id = pendingPaneFocus.current;
      if (!id) return;
      const panel = document.getElementById(`panel-${encodeURIComponent(id)}`);
      const noteHost = panel?.querySelector<HTMLElement>(".note-page-host");
      if (noteHost) noteHost.dispatchEvent(new Event("knot-focus-note"));
      else document.getElementById(`tab-${encodeURIComponent(id)}`)?.focus();
      pendingPaneFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [layout, busy, navigating, documentLoading, surface]);
  const favoriteRevision = useRef(0);
  const refresh = async (search = query) => {
    const revision = favoriteRevision.current;
    const generation = ++searchGeneration.current;
    const [rows, nextCatalog, nextTour] = await Promise.all([
      repository.catalog(),
      collections.catalog(),
      tourStatus(),
    ]);
    if (generation === searchGeneration.current) {
      setTour(nextTour);
      setItems(
        rows.filter((row) =>
          row.title.toLowerCase().includes(search.toLowerCase()),
        ),
      );
      setCatalog((current) =>
        revision === favoriteRevision.current
          ? nextCatalog
          : { ...nextCatalog, favorites: current.favorites },
      );
    }
    return rows;
  };
  async function run(task: () => Promise<void>, quiet = false) {
    if (locked.current) {
      if (quiet && navigationRunning.current) {
        // Keep editor changes serial, but honor the latest navigation click.
        pendingNavigation.current?.resolve();
        return new Promise<void>((resolve) => {
          pendingNavigation.current = { task, resolve };
        });
      }
      return;
    }
    locked.current = true;
    // Block interaction immediately, before React paints the loading state.
    if (host.current) host.current.inert = true;
    navigationRunning.current = quiet;
    if (quiet) setNavigating(true);
    else setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      report(e);
    } finally {
      locked.current = false;
      navigationRunning.current = false;
      if (quiet) setNavigating(false);
      else setBusy(false);
      const pending = pendingNavigation.current;
      pendingNavigation.current = null;
      if (pending) {
        try {
          await run(pending.task, true);
        } finally {
          pending.resolve();
        }
      }
    }
  }
  async function openLibrary(location: LibraryLocation, record = true) {
    await session.current?.flush();
    setAiPlacement((value) => (value === "page" ? "hidden" : value));
    clearInactiveSurface(null);
    setSurface(null);
    setShowSearch(false);
    setLibrary(location);
    setLibraryRevision((v) => v + 1);
    if (record) history.current.visit(location);
  }
  async function navigateHistory(
    item: KnowledgeObject | LibraryLocation | { id: string; ai: true },
  ) {
    if ("ai" in item) {
      showAi("page", false);
      return;
    }
    if ("library" in item) await openLibrary(item, false);
    else await select(item, false);
  }
  async function ensureLibraryCardSession() {
    if (!session.current) {
      session.current = await openEditor(
        {
          id: `deck-editor-${crypto.randomUUID()}`,
          title: "Card Deck",
          kind: "note",
          updated_at: Date.now(),
        },
        (status, error) => {
          setStatus(status);
          if (error) report(error);
        },
        undefined,
        (targetId) =>
          void run(async () => {
            await session.current?.flush();
            const target = (await repository.catalog()).find(
              (row) => row.id === targetId,
            );
            if (!target) throw new Error("This document is unavailable.");
            await select(target);
          }, true),
        () => void refresh().catch(report),
        (location) => void run(() => openPdf(location)),
        true,
        workspaceIdentity.current ?? undefined,
      );
      setLibraryRevision((value) => value + 1);
    }
    return session.current;
  }
  async function trashLibraryCards(ids: string[]) {
    const owner = await ensureLibraryCardSession();
    const live = ids.filter((id) => {
      const card = owner.cardDeck.data[id];
      return card && !card.deleted;
    });
    if (!live.length) throw new Error("This card is unavailable.");
    for (const id of live) owner.cardDeck.delete(id);
    await owner.flush();
    setLibraryRevision((value) => value + 1);
    setNotice(
      live.length === 1
        ? "Moved card to Trash."
        : `Moved ${live.length} cards to Trash.`,
    );
  }
  const trashLibraryCard = (id: string) => trashLibraryCards([id]);
  async function createLibraryCardEditor(id: string, host: HTMLElement) {
    return (await ensureLibraryCardSession()).createCardPageView(id, host);
  }
  function composeNotebookMcq() {
    const current = session.current;
    if (!current?.quizProgress) return;
    setMcqComposer((open) => open ?? {
      owner: current,
      notebookId: current.doc.id,
    });
  }
  useEffect(() => {
    const edit = (event: Event) => {
      const { cardId, doc } = (event as CustomEvent<McqEditRequest>).detail;
      const owner = session.current;
      if (!owner || owner.doc.spaceDoc !== doc) return;
      const initial = cardMcq(owner.cardDeck.data[cardId]);
      if (initial) setMcqComposer((open) => open ?? { cardId, initial, owner });
    };
    const insert = (event: Event) => {
      const target = (event as CustomEvent<McqInsertionTarget>).detail;
      const owner = session.current;
      if (owner?.doc === target.editor.doc)
        setMcqComposer((open) => open ?? { owner, target, notebookId: owner.doc.id });
    };
    const create = (event: Event) => {
      const { doc } = (event as CustomEvent<NewMcqRequest>).detail;
      if (session.current?.doc === doc) composeNotebookMcq();
    };
    window.addEventListener("knot-edit-mcq", edit);
    window.addEventListener("knot-insert-mcq", insert);
    window.addEventListener("knot-new-mcq", create);
    return () => {
      window.removeEventListener("knot-edit-mcq", edit);
      window.removeEventListener("knot-insert-mcq", insert);
      window.removeEventListener("knot-new-mcq", create);
    };
  }, []);
  async function openLibraryCard(id: string) {
    let completed = false;
    let found = false;
    await run(async () => {
      await session.current?.flush();
      const workspace = workspaceIdentity.current;
      const current = () => workspaceIdentity.current === workspace;
      const notebooks = await repository.catalog();
      notebooks.sort(
        (a, b) =>
          Number(b.id === session.current?.doc.id) -
          Number(a.id === session.current?.doc.id),
      );
      const location = await findCardPlacement(
        id,
        notebooks.map((row) => row.id),
        (owner) => {
          const doc = session.current?.collection.getDoc(owner);
          return doc?.root ? doc.spaceDoc : undefined;
        },
        repository.load,
        current,
      );
      if (!current()) throw Error("Workspace changed while opening this card.");
      if (location) {
        // A video, link, file or image lives on the canvas, never in Page view.
        const media = (session.current?.cardDeck.data[id] ?? undefined)?.media;
        await openNote(
          notebooks.find((row) => row.id === location.document)!,
          location.placement,
          media ? "edgeless" : undefined,
        );
        found = true;
      }
      completed = true;
    }, true);
    if (!completed) throw Error("Could not open this card. Please try again.");
    return found;
  }
  /** Ctrl+K: reuse a matching note's card on the open canvas or note. */
  async function reuseSearchCard(cardId: string, where: "canvas" | "note") {
    let completed = false;
    await run(async () => {
      const current = session.current;
      if (!current) throw Error("Open a notebook first.");
      setShowSearch(false);
      if (where === "canvas") {
        const placement = current.placeCard(cardId);
        if (!placement) throw Error("This card is no longer available.");
        await current.focusCanvasCard(placement);
      } else current.insertCard(cardId, searchInsertion.current);
      searchInsertion.current = undefined;
      await current.flush();
      completed = true;
    }, true);
    if (!completed) throw Error("Could not add this card. Please try again.");
  }
  async function placeLibraryCard(
    id: string,
    notebook?: KnowledgeObject,
    name?: string,
  ) {
    let completed = false;
    await run(async () => {
      if (notebook) await select(notebook);
      else if (name) await createNotebook(name);
      const current = session.current;
      if (
        !current ||
        !current.cardDeck.data[id] ||
        current.cardDeck.data[id].deleted
      )
        throw Error("This card is no longer available.");
      await withDocumentLoader("edgeless", () => current.setMode("edgeless"));
      const placement = current.placeCard(id);
      if (!placement) throw Error("Could not add this card to the notebook.");
      await current.focusCanvasCard(placement);
      setMode("edgeless");
      setFocusedNote(null);
      await current.flush();
      completed = true;
    }, true);
    if (!completed) throw Error("Could not add this card. Please try again.");
  }
  const moveHistory = (direction: -1 | 1) => {
    if (document.querySelector("dialog[open]")) return;
    if (
      direction === -1 ? !history.current.canBack : !history.current.canForward
    )
      return;
    void run(() => history.current.move(direction, navigateHistory), true);
  };
  useEffect(() => {
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      // Own the whole side-button gesture so WebView history and editor
      // handlers cannot also navigate. Move once, on release.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "mouseup") moveHistory(event.button === 3 ? -1 : 1);
    };
    const keyboard = (event: KeyboardEvent) => {
      const back = event.key === "BrowserBack";
      const forward = event.key === "BrowserForward";
      if (!back && !forward) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) moveHistory(back ? -1 : 1);
    };
    for (const type of ["mousedown", "mouseup", "auxclick"] as const)
      window.addEventListener(type, mouse, true);
    window.addEventListener("keydown", keyboard, true);
    return () => {
      for (const type of ["mousedown", "mouseup", "auxclick"] as const)
        window.removeEventListener(type, mouse, true);
      window.removeEventListener("keydown", keyboard, true);
    };
  });
  async function waitForReadyEditor() {
    const current = session.current;
    if (!current) return;
    try {
      await waitForEditorView(current.editor, current.editor.mode);
      if (session.current === current) setEditorLoadFailed(false);
    } catch (cause) {
      if (
        session.current !== current ||
        (cause instanceof DOMException && cause.name === "AbortError")
      )
        return;
      // A readiness failure must not turn a partially mounted editor editable.
      setEditorLoadFailed(true);
      throw cause;
    }
  }
  async function withDocumentLoader(
    view: "page" | "edgeless",
    navigate: () => Promise<void>,
  ) {
    // Keep the outgoing view visible during the grace period. BlockSuite can
    // mount the incoming root several frames before its update completes.
    const area = host.current;
    const outgoing = area?.querySelector("affine-page-root");
    outgoing?.setAttribute("data-outgoing-view", "");
    if (area) area.dataset.pendingView = view;
    const timer = window.setTimeout(() => {
      if (view === "page") setDocumentLoading(true);
    }, 150);
    try {
      if (view === "edgeless") {
        setTransition({ view, done: false });
        // Cover the canvas before document loading or rich-content layout starts.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }
      await navigate();
      await waitForReadyEditor();
    } finally {
      window.clearTimeout(timer);
      if (area) delete area.dataset.pendingView;
      outgoing?.removeAttribute("data-outgoing-view");
      setDocumentLoading(false);
      if (view === "edgeless") setTransition(null);
    }
  }
  /**
   * Shows a cited card in the view its document is open in: on the canvas
   * (opening a document follows Settings → open notes in) or as a page.
   */
  /** Opens the note or card holding an image whose OCR text was cited. */
  /** Opens the note or card holding an image whose OCR text was cited or
   * found by search (`fromSearch`: no Ask Knot pane or continuation). */
  async function openCitedImage(
    document: string,
    image: ImageLocation,
    fromSearch = false,
  ) {
    const gone = "This image is no longer in the source. The text read from it is shown here.";
    if (document.startsWith("deck:")) {
      const id = document.slice(5);
      const deck =
        session.current?.cardDeck.data ??
        (JSON.parse(await repository.loadCardDeck()) as DeckData);
      const card = deck[id];
      if (
        !card ||
        card.deleted ||
        !extractDeckPassages({ id: document, title: "Card Deck", revision: "" }, card)
          .images.some((ref) => ref.key === image.key)
      )
        throw Error(gone);
      // A placed card: open it where it sits and find the picture by its file.
      const placed = await cardPlacement(id);
      if (!placed) {
        setCitedDeckSource({ workspace: workspaceCatalog.active!, id, text: "" });
        openSurface("cardDeck");
        return;
      }
      if (fromSearch) await select(placed.owner);
      else {
        await selectCitation(placed.owner);
        openPane("ask");
      }
      const opened = session.current;
      if (!opened || opened.doc.id !== placed.owner.id) return;
      const block = opened.doc
        .getBlocksByFlavour("affine:image")
        .concat(opened.doc.getBlocksByFlavour("affine:attachment"))
        .map(({ model }) => model)
        .find((model) => {
          if ((model as unknown as { sourceId?: string }).sourceId !== image.key)
            return false;
          for (let at: typeof model | null = model; at; at = opened.doc.getParent(at))
            if (at.id === placed.placement) return true;
          return false;
        });
      if (!block) throw Error(gone);
      await revealImageBlock(opened, block.id, image.rects);
      return;
    }
    const source = (await repository.catalog()).find(
      (item) => item.id === document,
    );
    if (!source) throw Error("Source is unavailable or deleted.");
    const dirty = session.current
      ?.topicOverlay()
      .documents.find((row) => row.id === document);
    const snapshot = dirty ? dirty.snapshot : await repository.load(document);
    if (
      !snapshot ||
      !extractTopicContent({ id: document, title: "", revision: "" }, snapshot)
        .images.some(
          (ref) => ref.key === image.key && ref.blockId === image.blockId,
        )
    )
      throw Error(gone);
    if (fromSearch) await select(source);
    else {
      await selectCitation(source);
      openPane("ask");
    }
    const opened = session.current;
    if (!opened || opened.doc.id !== document) return;
    await revealImageBlock(opened, image.blockId, image.rects);
  }
  /** Where a Card Deck card is placed (the open notebook first), if anywhere. */
  async function cardPlacement(
    id: string,
  ): Promise<{ owner: KnowledgeObject; placement: string } | null> {
    const workspace = workspaceIdentity.current;
    const current = () => workspaceIdentity.current === workspace;
    const catalog = await repository.catalog();
    const owners = [...catalog].sort(
      (a, b) =>
        Number(b.id === session.current?.doc.id) -
          Number(a.id === session.current?.doc.id) || a.id.localeCompare(b.id),
    );
    const location = await findCardPlacement(
      id,
      owners.map((owner) => owner.id),
      (owner) => {
        const doc = session.current?.collection.getDoc(owner);
        return doc?.root ? doc.spaceDoc : undefined;
      },
      repository.load,
      current,
    );
    if (!location || !current()) return null;
    const owner = catalog.find((item) => item.id === location.document);
    return owner ? { owner, placement: location.placement } : null;
  }
  /** Reveals an image block (on the canvas or in the page) and marks lines. */
  async function revealImageBlock(
    opened: EditorSession,
    blockId: string,
    rects?: [number, number, number, number][],
  ) {
    // Reveal the note holding the image: a card on the canvas or in the notebook.
    let note: string | undefined;
    for (
      let model = opened.doc.getBlock(blockId)?.model ?? null;
      model;
      model = opened.doc.getParent(model)
    )
      if (model.flavour === "affine:note") {
        note = model.id;
        break;
      }
    if (opened.editor.mode === "edgeless") {
      if (note) await opened.focusCanvasCard(note);
    } else if (
      note &&
      opened.doc.spaceDoc.getMap<string>("knot:card-links").has(note)
    )
      await opened.focusNotebookNote(note);
    else await opened.setMode("page");
    setMode(opened.editor.mode);
    setFocusedNote(
      opened.editor.mode === "edgeless" ? null : (opened.revealedNoteId ?? null),
    );
    if (session.current !== opened) return;
    requestAnimationFrame(() => {
      const element = session.current?.editor.querySelector(
        `[data-block-id="${CSS.escape(blockId)}"]`,
      );
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      const picture = element?.querySelector("img");
      if (!picture || !rects?.length) {
        element?.animate(
          [{ outline: "3px solid #ffe08a" }, { outline: "3px solid transparent" }],
          { duration: 2400 },
        );
        return;
      }
      // Mark the lines the cited text was read from once the picture stops
      // moving (page scrolling, or the canvas opening and zooming to the card).
      void highlightImageLines(picture, rects);
    });
  }
  async function focusCitedCard(
    opened: EditorSession,
    id: string,
    excerpt: string,
  ) {
    const view = opened.editor.mode === "edgeless" ? "edgeless" : "page";
    if (view === "edgeless") await opened.focusCanvasCard(id);
    else await opened.focusNotebookNote(id);
    setMode(opened.editor.mode);
    setFocusedNote(view === "page" ? id : null);
    if (session.current !== opened) return;
    // Jump to the cited words inside the card and highlight them, as search does.
    await opened.revealSearchMatch(excerpt, id);
  }
  function select(item: KnowledgeObject, record = true) {
    const view =
      session.current?.doc.id === item.id
        ? session.current.editor.mode
        : item.kind === "whiteboard"
          ? "edgeless"
          : getNoteView();
    return withDocumentLoader(
      view,
      () => openDocument(item, record),
    );
  }
  async function openNote(
    item: KnowledgeObject,
    id: string,
    view = getNoteView(),
  ) {
    const currentCanvas =
      view === "edgeless" &&
      !library &&
      session.current?.doc.id === item.id &&
      session.current.editor.mode === "edgeless" &&
      !editorLoadFailed;
    if (currentCanvas) {
      await openDocument(item);
      await session.current!.focusCanvasCard(id);
      setMode("edgeless");
      setFocusedNote(null);
      return;
    }
    await withDocumentLoader(view, async () => {
      await openDocument(item);
      const current = session.current;
      if (!current || current.doc.id !== item.id)
        throw new Error("This notebook is no longer available.");
      if (view === "edgeless") {
        await current.focusCanvasCard(id);
      } else await current.focusNotebookNote(id);
      setMode(current.editor.mode);
      setFocusedNote(view === "page" ? id : null);
    });
    // The loader prepares canvas previews, which can change card bounds.
    // Recenter after its final readiness pass.
    if (view === "edgeless" && session.current?.doc.id === item.id)
      await session.current.focusCanvasCard(id);
  }
  async function selectCitation(item: KnowledgeObject) {
    if (session.current?.doc.id === item.id) return select(item);
    const continuation = {
      workspace: workspaceIdentity.current!,
      notebook: item.id,
    };
    citationContinuation.current = continuation;
    try {
      await select(item);
    } catch (error) {
      if (citationContinuation.current === continuation)
        citationContinuation.current = null;
      throw error;
    }
  }
  async function openDocument(item: KnowledgeObject, record = true) {
    // "Not shared" titles change only on import; refreshing here keeps every
    // newly opened notebook current. A failure just leaves the old titles.
    await knotbooks
      .unshared()
      .then(setUnsharedTitles)
      .catch(() => {});
    if (record && session.current?.doc.id === item.id) {
      setAiPlacement((value) => (value === "page" ? "hidden" : value));
      if (library) history.current.visit(item);
      setLibrary(null);
      clearInactiveSurface(null);
      setSurface((current) => (current === "browser" ? current : null));
      setShowSearch(false);
      return;
    }

    await session.current?.flush();
    const next = await openEditor(
      item,
      (s, e) => {
        setStatus(s);
        if (e) report(e);
      },
      (savedTitle) => {
        history.current.update(item.id, { title: savedTitle });
        setItems((rows) =>
          rows.map((row) =>
            row.id === item.id ? { ...row, title: savedTitle } : row,
          ),
        );
        setActive((current) =>
          current?.id === item.id ? { ...current, title: savedTitle } : current,
        );
        if (
          document.activeElement?.getAttribute("aria-label") !==
          "Document title"
        )
          setTitle(savedTitle);
      },
      (id) =>
        void run(async () => {
          await session.current?.flush();
          const target = (await repository.catalog()).find(
            (row) => row.id === id,
          );
          if (!target)
            throw new Error("This document was deleted or is unavailable.");
          await select(target);
        }, true),
      () => void refresh().catch(report),
      (location) => void run(() => openPdf(location)),
      false,
      workspaceIdentity.current ?? undefined,
    );
    if (record || active?.id !== item.id) {
      clearInactiveSurface(null);
      setSurface((current) => (current === "browser" ? current : null));
    }
    if (session.current) {
      const id = session.current.doc.id;
      const notes = session.current.notebookNotes();
      setFoldingNotes((previous) => ({ ...previous, [id]: notes }));
    }
    setAiPlacement((value) => (value === "page" ? "hidden" : value));
    session.current?.destroy();
    session.current = next;
    host.current?.replaceChildren(next.editor);
    setReferences(next.catalog.filter((row) => row.id !== item.id));
    setLibrary(null);
    setActive(item);
    setShowSearch(false);
    setPdfReader({ sources: next.pdfSources(), id: crypto.randomUUID() });
    setLinksView("add");
    setBacklinks(null);
    setTitle(item.title);
    setMode(next.editor.mode);
    setFocusedNote(next.revealedNoteId);
    if (record) history.current.visit(item);
    await next.editor.updateComplete;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }
  async function relocateWorkspace() {
    if (
      !confirm(
        "Create and open a copy in a new location? The source workspace will be retained as a recovery copy. Later edits to the two copies are independent.",
      )
    )
      return;
    await session.current?.flush();
    await flushChatSaves();
    const path = await workspaces.relocate();
    if (path) {
      await reloadWorkspace();
      setNotice(
        `Workspace relocated to ${path}. The source remains as a recovery copy.`,
      );
    }
  }

  async function reloadWorkspace() {
    // The backend already committed the workspace transition. Cleanup warnings
    // must not leave the editor attached to the previous workspace.
    await browserApi.dispose().catch(report);
    setBrowserRequest(null);
    setBrowserExpanded(false);
    setLibrary(defaultLibrary);
    setSurface(null);
    setShowSearch(false);
    setPdfReader(null);
    setVideoReader(null);
    setLinksView("add");
    setBacklinks(null);
    setCleanup(null);
    setIntegrity(null);
    setExporting(false);
    ++searchGeneration.current;
    history.current.clear();
    session.current?.destroy();
    session.current = null;
    host.current?.replaceChildren();
    setActive(null);
    setItems([]);
    setFoldingNotes({});
    setTitle("");
    setQuery("");
    setStatus("saved");
    setNotice("");
    setReferences([]);
    setCollectionUndo(null);
    setCatalog({ collections: [], favorites: [] });
    setTrash(null);
    setBackupEntries(null);
    setPickingWorkspace(false);
    const workspace = await workspaces.catalog();
    let savedAiPlacement: string | null = null;
    try {
      savedAiPlacement = localStorage.getItem(
        `knot.ai.placement.v1:${workspace.active}`,
      );
    } catch {
      /* Optional preference. */
    }
    setWorkspaceCatalog(workspace);
    setCatalog(await collections.catalog());
    const nextTour = await tourStatus();
    setTour(nextTour);
    if (nextTour.pending) {
      await createGettingStarted();
      setTour(await tourStatus());
    }
    await refresh("");
    await openLibrary(defaultLibrary);
    if (savedAiPlacement === "page" || savedAiPlacement === "panel")
      showAi(savedAiPlacement);
  }
  useEffect(() => {
    if (!isTauri()) {
      setError(
        "Open Knot with pnpm tauri dev. The browser preview has no durable workspace connection.",
      );
      dismissLaunchSplash();
      return;
    }
    void run(async () => {
      const workspace = await workspaces.catalog();
      let savedAiPlacement: string | null = null;
      try {
        savedAiPlacement = localStorage.getItem(
          `knot.ai.placement.v1:${workspace.active}`,
        );
      } catch {
        /* Optional preference. */
      }
      setWorkspaceCatalog(workspace);
      setCatalog(await collections.catalog());
      const nextTour = await tourStatus();
      setTour(nextTour);
      if (nextTour.pending) {
        await createGettingStarted();
        setTour(await tourStatus());
      }
      await refresh("");
      await openLibrary(defaultLibrary);
      if (savedAiPlacement === "page" || savedAiPlacement === "panel")
        showAi(savedAiPlacement);
      // Opened by double-clicking a .knotbook while Knot was closed.
      const launched = await knotbooks.pending().catch(() => null);
      if (launched) setImportToken(launched);
    }).finally(dismissLaunchSplash);
    let off: (() => void) | undefined;
    let gone = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (locked.current) {
          setError("An operation is in progress. Please wait before closing.");
          return;
        }
        await run(async () => {
          await prepareToClose.current();
          await getCurrentWindow().destroy();
        });
      })
      .then((fn) => {
        if (gone) fn();
        else off = fn;
      });
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  // Notices and timers outlive a render; the ref always opens Updates with
  // this render's surface handling.
  // Double-clicking a .knotbook while Knot is open: the second launch hands
  // the file over (single-instance) and this opens the import dialog.
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let gone = false;
    void listen<string>("knotbook-open", (event) => setImportToken(event.payload)).then(
      (fn) => {
        if (gone) fn();
        else off = fn;
      },
    );
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  const openUpdates = useRef(() => {});
  openUpdates.current = () => openSurface("updates");
  useEffect(() => {
    if (surface === "updates" && pendingUpdateVersion)
      setSeenUpdate(pendingUpdateVersion);
  }, [surface, pendingUpdateVersion]);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const view = (label: string) => ({ label, run: () => openUpdates.current() });
    void launchReport()
      .then((result) => {
        if (cancelled || !result) return;
        if (result.kind === "updated")
          showNotice(`Knot is now ${result.version}.`, view("What's new"));
        else
          showNotice(
            `The update to ${result.version} didn't finish. Knot ${result.current} is still installed and your notes are unchanged.`,
            view("Open Updates"),
          );
      })
      .catch(() => {});
    // A quiet check about 30 seconds after opening, then every few hours while
    // Knot stays open. checkForUpdate itself limits automatic checks to one a
    // day and does nothing when they're turned off.
    let timer = 0;
    const attempt = (delay: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (locked.current) return attempt(30_000);
        void checkForUpdate({ manual: false }).then((result) => {
          if (!cancelled && result.kind === "available" && shouldAnnounce(result.version))
            showNotice(`Knot ${result.version} is available.`, view("View"));
          attempt(6 * 60 * 60 * 1000);
        });
      }, delay);
    };
    attempt(30_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  const installAppUpdate = () => {
    if (locked.current || getUpdateState().kind !== "ready") {
      setError("An operation is in progress. Please wait before updating.");
      return;
    }
    void run(async () => {
      // installUpdate saves, backs up, then exits Knot through the installer.
      // A failed save or backup throws here and keeps the current version.
      await installUpdate(async (step) => {
        await flushPendingWork();
        step("backup");
        await backups.create();
      });
    });
  };
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(() => void refresh(query).catch(report), 180);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        void run(async () => {
          await session.current?.flush();
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        if (document.querySelector("dialog[open]") && !showSearch) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busy) {
          // Before search takes focus: where a reused card goes in Page view.
          if (!showSearch)
            searchInsertion.current = session.current?.captureInsertionTarget();
          setShowSearch((open) => !open);
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [busy, showSearch]);
  const pageModeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const openSelectedCard = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        event.key !== "Enter" ||
        event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
        event.repeat
      )
        return;
      const current = session.current;
      const button = pageModeButton.current;
      if (
        !button ||
        button.disabled ||
        current?.editor.mode !== "edgeless" ||
        document.querySelector("dialog[open]")
      )
        return;
      const target = event.target;
      if (
        !current.selectedCanvasNoteId() ||
        !(target instanceof Node) ||
        (target instanceof Element &&
          (target.closest("input,textarea,select") ||
            (!current.editor.contains(target) &&
              target.closest('[contenteditable="true"],[role=textbox]'))))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      button.click();
    };
    window.addEventListener("keydown", openSelectedCard, true);
    return () => window.removeEventListener("keydown", openSelectedCard, true);
  }, []);
  const createNotebook = async (name: string) => {
    await session.current?.flush();
    const id = await repository.create("note");
    await repository.rename(id, name);
    setQuery("");
    const rows = await refresh("");
    await select(
      rows.find((x) => x.id === id) ?? {
        id,
        title: name,
        kind: "note",
        updated_at: Date.now(),
      },
    );
  };
  // From New notebook: open it with the cursor in its first, empty note.
  // Waits a frame so the naming popover returns focus to its button first.
  const createNotebookAndWrite = async (name: string) => {
    await createNotebook(name);
    requestAnimationFrame(() => session.current?.focusEmptyNote());
  };
  const addNote = () =>
    run(async () => {
      setAiPlacement((value) => (value === "page" ? "hidden" : value));
      const current = session.current;
      if (!current || !active) return;
      clearInactiveSurface(null);
      setSurface((value) => (value === "browser" ? value : null));
      await current.addNotebookNote();
      setMode(current.editor.mode);
      setFocusedNote(current.revealedNoteId);
      setCollapsedNotebook(null);
    });
  useEffect(() => {
    if (!aiEnabled) return;
    return observeAiToolbar(
      () => session.current?.editor,
      () => {
        const s = session.current;
        if (!s || !workspaceCatalog.active || busy || navigating) return;
        setAiContext(
          captureAiContext(
            focusedEditor.current?.doc === s.doc
              ? focusedEditor.current
              : s.editor,
            workspaceCatalog.active,
            focusedEditor.current?.doc === s.doc
              ? (focusedEditor.current.dataset.notePane ?? s.revealedNoteId)
              : s.revealedNoteId,
          ),
        );
        openSurface("ask");
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLTextAreaElement>(".ask-knot textarea")
            ?.focus(),
        );
      },
    );
  }, [aiEnabled, active?.id, workspaceCatalog.active, busy, navigating]);
  async function focusTourStart() {
    const editor = session.current?.editor;
    if (!editor) return;
    await editor.updateComplete;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const viewport = editor.querySelector("affine-edgeless-root")?.service
      .viewport;
    if (viewport) {
      const bounds = editor.getBoundingClientRect();
      viewport.setZoom(
        Math.max(
          0.3,
          Math.min(0.9, (bounds.width - 64) / 900, (bounds.height - 160) / 820),
        ),
      );
      viewport.setCenter(460, 440);
    }
  }
  function openTourCanvas(target: KnowledgeObject) {
    return withDocumentLoader("edgeless", async () => {
      await openDocument(target);
      await session.current?.setMode("edgeless");
      setMode("edgeless");
      setFocusedNote(null);
      await focusTourStart();
    });
  }
  const openTour = (fresh = false) =>
    run(async () => {
      await session.current?.flush();
      const id = await createGettingStarted(fresh);
      setTour(await tourStatus());
      setQuery("");
      const rows = await refresh("");
      const target = rows.find((row) => row.id === id);
      if (!target)
        throw new Error(
          "Getting Started is unavailable. Try creating a fresh copy.",
        );
      await openTourCanvas(target);
      setNotice(
        fresh
          ? "Created a fresh tour. Your previous copy is unchanged."
          : "Getting Started is ready to explore.",
      );
    });
  const reloadCollections = async () => {
    await refresh();
  };
  const isFavorite = !!active && catalog.favorites.includes(active.id);
  const toggleFavorite = (id: string) => {
    if (locked.current) return;
    locked.current = true;
    const favorite = !catalog.favorites.includes(id);
    // A metadata toggle must not put the shell into its navigation/loading state.
    void (async () => {
      try {
        setError("");
        await collections.favorite(id, favorite);
        ++favoriteRevision.current;
        setCatalog((current) => ({
          ...current,
          favorites: favorite
            ? [...new Set([...current.favorites, id])]
            : current.favorites.filter((value) => value !== id),
        }));
      } catch (e) {
        report(e);
      } finally {
        locked.current = false;
      }
    })();
  };
  const sidebarPreferences = useSidebarPreferences(
    workspaceCatalog.active,
    active?.id,
  );
  const sidebarDrag = useSidebarDrag(
    catalog,
    busy || navigating,
    run,
    reloadCollections,
    (item) => requestTrash(item, "drop"),
    setCollectionTrash,
    sidebarPreferences.pin,
    (id, target, after) =>
      sidebarPreferences.reorderFavorites(
        reorderedCollections(
          orderedFavorites(
            [...new Set([...catalog.favorites, id])],
            sidebarPreferences.favoriteOrder,
          ),
          id,
          target,
          after,
        ),
      ),
  );
  const favoriteItems = orderedFavorites(
    catalog.favorites,
    sidebarPreferences.favoriteOrder,
  )
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is KnowledgeObject => !!item);
  const recentItems = sidebarPreferences.recent
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is KnowledgeObject => !!item)
    .slice(0, 5);
  const pinnedCollections = catalog.collections.filter((collection) =>
    sidebarPreferences.pinned.includes(collection.id),
  );
  const activePlace = active
    ? expandedPlace(
        [
          ...(!sidebarPreferences.favoritesClosed &&
          favoriteItems.some((item) => item.id === active.id)
            ? ["@favorites"]
            : []),
          ...(recentItems.some((item) => item.id === active.id)
            ? ["@recent"]
            : []),
          ...pinnedCollections
            .filter(
              (collection) =>
                sidebarPreferences.openCollections.includes(collection.id) &&
                collection.notebooks.includes(active.id),
            )
            .map((collection) => collection.id),
        ],
        notebookPlace,
      )
    : null;
  const renderNotebook = (
    item: KnowledgeObject,
    source: string | null = null,
    fromFavorites = false,
  ) => {
    const place = fromFavorites ? "@favorites" : (source ?? "@recent");
    const isActive = active?.id === item.id;
    const expanded =
      isActive && activePlace === place && collapsedNotebook !== item.id;
    return (
      <div key={item.id} className="document-notebook">
        <div
          className="notebook-row"
          {...(fromFavorites
            ? sidebarDrag.drop({ kind: "favorites", id: item.id })
            : {})}
          data-drop={
            fromFavorites ? sidebarDrag.favoriteIndicator(item.id) : undefined
          }
          {...sidebarDrag.start({
            kind: "notebook",
            item,
            source,
            fromFavorites,
          })}
          onContextMenu={(event) => {
            event.preventDefault();
            event.currentTarget
              .querySelector<HTMLButtonElement>(".collection-membership-trigger")
              ?.click();
          }}
        >
          {isActive ? (
            // Only the open notebook has notes to show; other rows open on click.
            <button
              className="notebook-toggle"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
              aria-expanded={expanded}
              disabled={busy}
              onClick={() => {
                setNotebookPlace(place);
                setCollapsedNotebook(expanded ? item.id : null);
              }}
            >
              <ShellIcon name="chevron" />
            </button>
          ) : (
            <span className="notebook-toggle" aria-hidden="true" />
          )}
          <button
            key={item.id}
            data-tooltip={item.title}
            aria-current={!library && active?.id === item.id ? "page" : undefined}
            className={`document-row ${!library && active?.id === item.id ? "selected" : ""}`}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setNotebookPlace(place);
                setCollapsedNotebook(null);
                await select(item);
              }, true)
            }
          >
            <span className="document-icon">
              <ShellIcon name="notebook" expanded={expanded} />
            </span>
            <span>{item.title}</span>
          </button>
          <CollectionMembership
            object={item.id}
            title={item.title}
            onRename={(name) => renameNotebook(item, name)}
            onTrash={() => requestTrash(item)}
            favorite={catalog.favorites.includes(item.id)}
            onFavorite={() => toggleFavorite(item.id)}
            catalog={catalog}
            busy={busy}
            run={run}
            onChanged={reloadCollections}
          />
        </div>
        <Disclosure open={expanded && !!session.current}>
          <div className="notebook-disclosure">
            <NotebookContents
              key={item.id}
              session={active?.id === item.id ? session.current : null}
              frozenNotes={
                active?.id !== item.id ? foldingNotes[item.id] : undefined
              }
              busy={busy}
              mode={mode}
              focusedNote={focusedNote}
              onView={(view) =>
                void run(async () => {
                  clearInactiveSurface(null);
                  setSurface((current) =>
                    current === "browser" ? current : null,
                  );
                  await withDocumentLoader(view, async () => {
                    if (library) await openDocument(item);
                    await session.current?.setMode(view);
                    setMode(view);
                    setFocusedNote(session.current?.revealedNoteId ?? null);
                  });
                }, true)
              }
              onNote={(id) =>
                void run(async () => {
                  clearInactiveSurface(null);
                  setSurface((current) =>
                    current === "browser" ? current : null,
                  );
                  await openNote(item, id);
                }, true)
              }
              onShared={(id) =>
                void run(async () => {
                  const target = (await repository.catalog()).find(
                    (row) => row.id === id,
                  );
                  if (!target)
                    throw new Error(
                      "This shared note was deleted or is unavailable.",
                    );
                  await select(target);
                }, true)
              }
            />
          </div>
        </Disclosure>
      </div>
    );
  };
  const stableAiContext = useMemo(() => {
    const current = session.current;
    if (!current || !workspaceCatalog.active) return null;
    if (aiContext?.instance === current.doc) return aiContext;
    return {
      ...captureAiContext(
        current.editor,
        workspaceCatalog.active,
        current.revealedNoteId,
      ),
      sourceIntent: "ambient" as const,
    };
  }, [aiContext, workspaceCatalog.active, active?.id]);
  return (
    <div className="app-shell" aria-busy={busy}>
      {collectionTrash && (
        <TrashConfirmation
          kind="move"
          title={`Move “${catalog.collections.find((c) => c.id === collectionTrash)?.name ?? "collection"}” to Trash?`}
          count={1}
          description="Only the collection will move to Trash. Its notebooks will stay in your library. You can restore the collection for 30 days."
          onClose={() => setCollectionTrash(null)}
          onConfirm={async () => {
            await collections.delete(collectionTrash);
            setTrashIcon("folder");
            if (library?.collection === collectionTrash)
              await openLibrary({ id: "collections", library: "collections" });
            await reloadCollections();
            setLibraryRevision((value) => value + 1);
            await animateTrashDrop("folder", () => setCollectionTrash(null));
          }}
        />
      )}
      {moveSelection && (
        <TrashConfirmation
          kind="move"
          title={`Move “${moveSelection.title}” to Trash?`}
          count={1}
          onClose={() => setMoveSelection(null)}
          onConfirm={async () => {
            await session.current?.flush();
            await repository.delete(moveSelection.id);
            setTrashIcon("notebook");
            const origin = trashOrigin.current;
            if (origin !== "drop") {
              setTrashAnimation((value) => ({
                ...value,
                [origin]: value[origin] + 1,
                dropped: origin === "sidebar" ? false : value.dropped,
              }));
              setMoveSelection(null);
            }
            await run(async () => {
              setSurface(null);
              setShowSearch(false);
              setPdfReader(null);
              setVideoReader(null);
              setLinksView("add");
              setBacklinks(null);
              if (trash !== null) await loadTrash();
              history.current.remove(moveSelection.id);
              if (session.current?.doc.id === moveSelection.id) {
                session.current.destroy();
                session.current = null;
                host.current?.replaceChildren();
                setActive(null);
                setTitle("");
                const rows = await refresh();
                if (rows[0] && !library) await select(rows[0]);
              } else await refresh();
              await reloadCollections();
              setLibraryRevision((value) => value + 1);
            });
            if (origin === "drop") {
              await animateTrashDrop("notebook", () => setMoveSelection(null));
            }
          }}
        />
      )}

      {mcqComposer && (() => {
        const { owner, target, notebookId, cardId, initial, source } = mcqComposer;
        const legacyId = cardId ? "edit:" + cardId : "new:" + (notebookId ?? "deck");
        const id = target ? `inline:v1:${notebookId}:${target.noteId}` : legacyId;
        return (
          <McqComposer
            id={id}
            windowCloseDraft={flushMcqDraft}
            initial={initial}
            source={source}
            anchor={target?.rect}
            deck={target ? owner.cardDeck : undefined}
            notebookId={notebookId}
            onReload={cardId ? () => {
              const card = owner.cardDeck.data[cardId];
              return card?.deleted ? undefined : cardMcq(card);
            } : undefined}
            onClose={(focus) => {
              setMcqComposer(undefined);
              if (focus) focus();
              else if (target) requestAnimationFrame(() => restoreMcqTarget(target));
            }}
            onInsert={target ? async (questionId, operationId) => {
              if (session.current !== owner) throw Error("The original editor is closed.");
              const { focus } = await owner.insertQuestion(questionId, target, operationId);
              return focus;
            } : undefined}
            onSave={async (draft, expected, copy, another) => {
              const destination = copy ? { kind: "deck" as const } :
                target ? { kind: "inline" as const, target } :
                notebookId && !cardId ? { kind: "standalone" as const } : { kind: "deck" as const };
              const current = copy && target && session.current !== owner &&
                  workspaceIdentity.current === owner.cardDeck.workspace
                ? await ensureLibraryCardSession() : owner;
              if (session.current !== current) throw Error("The original editor is closed.");
              const { placement, focus, next } = await current.publishQuestion(draft, id, {
                cardId: copy ? undefined : cardId,
                expected,
                destination,
              });
              // Add another: the next inline question goes right after this one.
              if (another && next)
                setMcqComposer((open) => open && { ...open, target: next });
              if (placement) {
                try {
                  if (current.editor.mode === "edgeless") await current.focusCanvasCard(placement);
                  else await current.focusNotebookNote(placement);
                  setMode(current.editor.mode);
                  setFocusedNote(current.revealedNoteId);
                } catch (error) {
                  report(error);
                }
              }
              setLibraryRevision((value) => value + 1);
              return focus;
            }}
          />
        );
      })()}
      {sharing && (
        <ShareNotebookDialog
          root={sharing}
          catalog={() => repository.catalog()}
          load={repository.load}
          prepare={flushPendingWork}
          onClose={() => setSharing(null)}
          onSaved={(filename) => {
            setSharing(null);
            showNotice(`Saved ${filename}`, {
              label: "Show in folder",
              run: () => void knotbooks.showLast().catch(report),
            });
          }}
        />
      )}
      {importToken && (
        <ImportNotebookDialog
          key={importToken}
          inspect={() => knotbooks.inspect(importToken)}
          collections={catalog.collections}
          context={async () => {
            await flushPendingWork();
            const [deck, rows] = await Promise.all([
              repository.loadCardDeck(),
              repository.catalog(),
            ]);
            return {
              deck: JSON.parse(deck) as Record<string, unknown>,
              titles: new Set(rows.map((row) => row.title)),
            };
          }}
          onImport={async (plan, collection) => {
            const written = await knotbooks.import(importToken, { ...plan, collection });
            setImportToken(null);
            setCatalog(await collections.catalog());
            await refresh();
            // Reload the open notebook in case it was replaced.
            if (active) await select(active, false);
            const first = written[0];
            // The shared notebook (listed first) shows under Recently visited.
            if (first) sidebarPreferences.markRecent([first]);
            showNotice(
              `Imported ${written.length} ${written.length === 1 ? "notebook" : "notebooks"}`,
              {
                label: "Open",
                run: () =>
                  void repository
                    .catalog()
                    .then((rows) => rows.find((row) => row.id === first))
                    .then((row) => row && select(row))
                    .catch(report),
              },
            );
          }}
          onClose={() => setImportToken(null)}
          onOpenUpdates={() => {
            setImportToken(null);
            openSurface("updates");
          }}
          onOpenBackups={() => {
            setImportToken(null);
            void run(async () => {
              openSurface("backups");
              setBackupEntries(await backups.list());
            });
          }}
        />
      )}
      {quizReset && <TrashConfirmation title="Reset quiz progress?" count={1}
        description="This permanently clears all quiz answers and attempt history in this notebook."
        onClose={() => setQuizReset(false)}
        onConfirm={async () => {
          await session.current?.quizProgress?.reset();
          setQuizReset(false);
        }} />}
      {cardEdit && session.current && (
        <CardEditDialog
          key={cardEdit}
          cardId={cardEdit}
          title={
            cardPreview(
              session.current.cardDeck.data[cardEdit] ?? { id: cardEdit, nodes: [] },
              "",
            )
              .split(/\r?\n/)[0]
              .trim()
              .slice(0, 120) || "Untitled card"
          }
          create={(id, host) => {
            const current = session.current;
            if (!current) throw Error("The notebook is closed.");
            return current.createCardPageView(id, host);
          }}
          onClose={async () => {
            await session.current?.flush();
            setCardEdit(null);
          }}
        />
      )}
      {showSearch && (
        <GlobalSearch
          reuse={
            !library && session.current && active
              ? session.current.editor.mode === "edgeless"
                ? {
                    label: "Add to this canvas",
                    // A note from this notebook is already on its canvas.
                    available: (result) =>
                      result.source.id !== session.current?.doc.id,
                    run: (result) => reuseSearchCard(result.cardId!, "canvas"),
                  }
                : {
                    label: "Insert into this note",
                    available: () => true,
                    run: (result) => reuseSearchCard(result.cardId!, "note"),
                  }
              : undefined
          }
          preferredView={noteView}
          isResultOnCurrentPage={({ source, noteId }) =>
            !library &&
            isSearchResultOnPage(session.current?.editor, source.id, noteId)
          }
          search={async (searchQuery, signal) => {
            const report = await scanSearch(searchQuery, signal);
            const ocr = await ocrSearch(searchQuery).catch(() => []);
            signal.throwIfAborted();
            return { ...report, results: [...report.results, ...ocr] };
          }}
          onOpenOcr={async (result) => {
            let opened = false;
            await run(async () => {
              setShowSearch(false);
              if (result.image)
                // The image's own document: a Card Deck card is listed under
                // the notebook it sits on but opened through the card.
                await openCitedImage(result.image.documentId, result.image, true);
              else if (result.pdf) {
                await select(result.source);
                await openPdf(result.pdf);
              }
              opened = true;
            }, true);
            if (!opened)
              throw new Error("Could not open this result. Please try again.");
          }}
          recent={() => repository.list("", 0, { collection: null })}
          onClose={() => setShowSearch(false)}
          onOpen={async (source, noteId, view, query) => {
            let opened = false;
            const reusePage =
              view !== "edgeless" &&
              !library &&
              isSearchResultOnPage(session.current?.editor, source.id, noteId);
            await run(async () => {
              setShowSearch(false);
              if (!reusePage) {
                if (noteId) await openNote(source, noteId, view);
                else await select(source);
              }
              await session.current?.revealSearchMatch(query ?? "", noteId);
              opened = true;
            }, true);
            if (!opened)
              throw new Error(
                "Could not open this document. Please try again.",
              );
          }}
        />
      )}
      <SidebarFrame collapsed={collapsed} onCollapse={setCollapsed}>
        <aside className="sidebar" aria-label="Workspace navigation">
          <div className="brand">
            <img
              className="brand-mark"
              src="/knot-mark.svg"
              alt=""
              width="40"
              height="40"
            />
            <span>Knot</span>
          </div>
          {library || !active ? (
            <AddNotePicker
              key={workspaceCatalog.active}
              busy={busy || navigating}
              onChoose={async (destination) => {
                let succeeded = false;
                await run(async () => {
                  await select(destination);
                  const current = session.current;
                  if (!current)
                    throw new Error("Could not open this notebook.");
                  clearInactiveSurface(null);
                  setSurface(null);
                  await current.addNotebookNote();
                  setMode(current.editor.mode);
                  setFocusedNote(current.revealedNoteId);
                  setCollapsedNotebook(null);
                  succeeded = true;
                });
                if (!succeeded)
                  throw new Error("Could not add the note. Please try again.");
              }}
              onCreate={async (name) => {
                let succeeded = false;
                await run(async () => {
                  await createNotebook(name);
                  succeeded = true;
                });
                if (!succeeded)
                  throw new Error(
                    "Could not create the notebook. Please try again.",
                  );
              }}
            />
          ) : (
            <button
              className="primary"
              disabled={busy || navigating}
              data-tooltip={`Add a note to ${active.title || "this notebook"}`}
              onClick={() => void addNote()}
            >
              <ShellIcon name="note" /> Add note
            </button>
          )}
          <NewNotebook
            busy={busy || navigating}
            run={run}
            onCreate={createNotebookAndWrite}
          />
          <button
            disabled={busy}
            aria-keyshortcuts="Control+k Meta+k"
            onClick={() => setShowSearch(true)}
          >
            <ShellIcon name="search" /> Search{" "}
            <kbd className="search-shortcut">Ctrl K</kbd>
          </button>
          {aiEnabled && (
            <button
              className="sidebar-ask"
              disabled={busy || navigating}
              aria-label="Ask Knot"
              aria-pressed={aiPlacement !== "hidden"}
              // Beside an open document (a canvas you're panning, a note you're
              // reading), Ask Knot opens as a panel so you keep your place; as a
              // page only when there is nothing to keep, such as the Library.
              onClick={() =>
                showAi(session.current && !library ? "panel" : "page")
              }
            >
              <ShellIcon name="sparkles" /> Ask Knot
            </button>
          )}
          <button
            aria-current={
              library && aiPlacement !== "page" ? "page" : undefined
            }
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  openLibrary({
                    id: `library:${library?.library ?? "notebooks"}`,
                    library: library?.library ?? "notebooks",
                  }),
                true,
              )
            }
          >
            <ShellIcon name="library" /> Library
          </button>
          <div className="section-label">
            <span>Library</span>
            <CreateCollection
              busy={busy}
              run={run}
              onChanged={reloadCollections}
            />
          </div>
          <nav
            className="library"
            aria-label="Documents"
            {...sidebarDrag.drop({ kind: "pin" })}
          >
            <Favorites
              items={favoriteItems}
              open={!sidebarPreferences.favoritesClosed}
              onOpenChange={sidebarPreferences.setFavoritesOpen}
              dropProps={sidebarDrag.drop({ kind: "favorites" })}
              dropIndicator={
                sidebarDrag.target?.kind === "favorites" &&
                !sidebarDrag.target.id
                  ? "inside"
                  : undefined
              }
              renderNotebook={(item) => renderNotebook(item, null, true)}
            />
            <div className="uncollected-label">Recently visited</div>
            {recentItems.map((item) => renderNotebook(item))}
            {!recentItems.length && (
              <p className="sidebar-empty-state">
                Notebooks you open appear here
              </p>
            )}
            <div
              className="sidebar-pin-target"
              {...sidebarDrag.drop({ kind: "pin" })}
              data-drop={
                sidebarDrag.target?.kind === "pin" ? "inside" : undefined
              }
            >
              <div className="uncollected-label">Pinned collections</div>
              {!pinnedCollections.length && (
                <p className="sidebar-empty-state">
                  Pin a collection from Library to keep it here
                </p>
              )}
            </div>
            {pinnedCollections.map((collection) => (
                <CollectionGroup
                  key={collection.id}
                  collection={collection}
                  open={sidebarPreferences.openCollections.includes(
                    collection.id,
                  )}
                  onToggle={() =>
                    sidebarPreferences.toggleCollectionOpen(collection.id)
                  }
                  pinned={sidebarPreferences.pinned}
                  onTogglePin={sidebarPreferences.togglePin}
                  dragProps={{
                    ...sidebarDrag.start({
                      kind: "collection",
                      id: collection.id,
                    }),
                    ...sidebarDrag.drop({
                      kind: "collection",
                      id: collection.id,
                    }),
                  }}
                  dropIndicator={sidebarDrag.indicator(collection.id)}
                  catalog={catalog}
                  busy={busy}
                  run={run}
                  onChanged={reloadCollections}
                >
                  {() =>
                    items
                      .filter((item) => collection.notebooks.includes(item.id))
                      .map((item) => renderNotebook(item, collection.id))
                  }
                </CollectionGroup>
              ))}
          </nav>
          {sidebarDrag.drag && (
            <div className="sidebar-drag-status" role="status">
              {sidebarDrag.message ||
                (sidebarDrag.drag.kind === "notebook"
                  ? "Drop into a collection or Trash · Ctrl to keep both"
                  : "Drag to pin or reorder collections")}
            </div>
          )}
          <div className="sidebar-footer">
            <button
              className={
                sidebarDrag.sourceName
                  ? "sidebar-settings sidebar-remove-drop"
                  : "sidebar-settings"
              }
              {...(sidebarDrag.sourceName
                ? sidebarDrag.drop({ kind: "remove" })
                : {})}
              data-drop={
                sidebarDrag.target?.kind === "remove" ? "inside" : undefined
              }
              disabled={busy}
              onClick={() => openSurface("settings")}
            >
              {sidebarDrag.sourceName ? (
                `Remove from ${sidebarDrag.sourceName}`
              ) : (
                <>
                  <ShellIcon name="options" /> Settings
                  {updateDot && (
                    <span className="sidebar-update-dot" aria-label="Update available" role="img" />
                  )}
                </>
              )}
            </button>{" "}
            <button
              disabled={busy}
              {...sidebarDrag.drop({ kind: "trash" })}
              data-drop={
                sidebarDrag.target?.kind === "trash" ? "inside" : undefined
              }
              onClick={() =>
                void run(async () => {
                  await loadTrash("");
                  setTrashQuery("");
                })
              }
            >
              <AnimatedTrash
                revision={trashAnimation.sidebar}
                item={trashIcon}
                dragOver={
                  sidebarDrag.target?.kind === "trash" ||
                  collectionTrash !== null ||
                  (moveSelection !== null && trashOrigin.current === "drop")
                }
                dropped={trashAnimation.dropped}
              />{" "}
              Trash
            </button>
          </div>
        </aside>
      </SidebarFrame>
      <main
        className={`${surface ? "has-tool-surface" : ""} ai-placement-${aiPlacement}`}
        style={
          {
            "--panel-width": `${activePanelWidth}px`,
          } as React.CSSProperties
        }
      >
        <header className="topbar">
          <button
            className="icon-button"
            data-tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <ShellIcon name="sidebar" />
          </button>
          <button
            aria-label="Go back"
            data-tooltip="Go back"
            disabled={busy || !history.current.canBack}
            onClick={() => moveHistory(-1)}
          >
            <ShellIcon name="back" />
          </button>
          <button
            aria-label="Go forward"
            data-tooltip="Go forward"
            disabled={busy || !history.current.canForward}
            onClick={() => moveHistory(1)}
          >
            <ShellIcon name="forward" />
          </button>
          {aiPlacement === "page" ? (
            <span className="breadcrumb">Ask Knot</span>
          ) : library ? (
            <>
              <nav className="library-breadcrumb" aria-label="Library location">
                <button
                  onClick={() =>
                    void run(
                      () =>
                        openLibrary({
                          id: `library:${library.library}`,
                          library: library.library,
                        }),
                      true,
                    )
                  }
                >
                  Library
                </button>
                {library.collection !== undefined && (
                  <>
                    <span>/</span>
                    <span>
                      {library.collection === ""
                        ? "Uncollected"
                        : (catalog.collections.find(
                            (c) => c.id === library.collection,
                          )?.name ?? "Collection unavailable")}
                    </span>
                  </>
                )}
              </nav>
              {library.library === "cardDeck" && (
                <div id="library-card-chrome" />
              )}
            </>
          ) : !active ? (
            layout.groups.length > 0 && (
              <ColumnVisibilityToggle
                layout={layout}
                dispatch={dispatchLayout}
                disabled={busy || navigating}
              />
            )
          ) : (
            <>
              <div className="notebook-title">
                <input
                  style={{
                    width: `${Math.max(8, Array.from(title).length + 1)}ch`,
                  }}
                  className="title-input"
                  aria-label="Document title"
                  data-tooltip={title || "Document title"}
                  value={title}
                  disabled={!active || busy || navigating}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={() => {
                    if (active && title !== active.title)
                      void run(async () => {
                        await session.current?.rename(title);
                        setActive({ ...active, title });
                        await refresh();
                      });
                  }}
                />
                {mode === "page" && focusedNote && session.current && (
                  <NoteCrumb session={session.current} noteId={focusedNote} />
                )}
                <button
                  className="favorite-toggle icon-button"
                  aria-label={
                    isFavorite
                      ? "Remove notebook from favorites"
                      : "Add notebook to favorites"
                  }
                  data-tooltip={
                    isFavorite
                      ? "Remove notebook from favorites"
                      : "Add notebook to favorites"
                  }
                  aria-pressed={isFavorite}
                  disabled={!active || busy || navigating}
                  onClick={() => active && toggleFavorite(active.id)}
                >
                  <AnimatedFavorite key={active?.id} favorite={isFavorite} />
                </button>
                <button
                  className={`save-status ${status}`}
                  aria-live="polite"
                  data-tooltip="Save now / retry"
                  aria-label="Save now / retry"
                  onClick={() =>
                    void run(async () => {
                      await session.current?.flush();
                    })
                  }
                >
                  {status === "saved"
                    ? "✓ Saved"
                    : status === "saving"
                      ? "◌ Saving…"
                      : "! Save failed · Retry"}
                </button>
              </div>

              <div className="mode-switch">
                {(["page", "edgeless"] as const).map((m) => (
                  <button
                    key={m}
                    ref={m === "page" ? pageModeButton : undefined}
                    aria-keyshortcuts={
                      m === "page" ? "Control+Enter" : undefined
                    }
                    title={
                      m === "page" && mode === "edgeless"
                        ? "Open selected card in Page view (Ctrl+Enter)"
                        : undefined
                    }
                    disabled={!active || busy}
                    aria-pressed={mode === m}
                    className={mode === m ? "current" : ""}
                    onClick={() => {
                      // Inerting the canvas and painting the transition can blur
                      // its editor. Capture the selected note before either.
                      const origin = session.current;
                      const selectedNote =
                        m === "page" ? origin?.selectedCanvasNoteId() : null;
                      void run(async () => {
                        if (session.current) {
                          if (
                            surface &&
                            [
                              "settings",
                              "editorSettings",
                              "aiSettings",
                              "updates",
                              "workspaceSettings",
                              "workspace",
                              "backups",
                              "trash",
                              "integrity",
                              "quarantine",
                            ].includes(surface)
                          ) {
                            clearInactiveSurface(null);
                            setSurface(null);
                          }
                          const current = session.current;
                          const switching = current.editor.mode !== m;
                          try {
                            if (switching) {
                              setTransition({ view: m, done: false });
                              // Paint before BlockSuite starts mounting the destination.
                              await new Promise<void>((resolve) =>
                                requestAnimationFrame(() =>
                                  requestAnimationFrame(() => resolve()),
                                ),
                              );
                            }
                            if (
                              m === "page" &&
                              selectedNote &&
                              current === origin
                            )
                              await current.focusNotebookNote(selectedNote);
                            else await current.setMode(m);
                            if (
                              session.current !== current ||
                              current.editor.mode !== m
                            )
                              return;
                            setMode(m);
                            setFocusedNote(current.revealedNoteId);
                            if (switching) {
                              await waitForReadyEditor();
                              setTransition({ view: m, done: true });
                              if (
                                m !== "edgeless" &&
                                !matchMedia("(prefers-reduced-motion: reduce)")
                                  .matches
                              )
                                await new Promise((resolve) =>
                                  setTimeout(resolve, 220),
                                );
                            }
                          } finally {
                            setTransition(null);
                          }
                        }
                      }, true);
                    }}
                  >
                    <ShellIcon name={m === "page" ? "note" : "board"} />{" "}
                    {m === "page" ? "Page" : "Canvas"}
                  </button>
                ))}
              </div>
              <div
                className="document-quick-actions"
                role="group"
                aria-label="Quick document actions"
              >
                <ColumnVisibilityToggle
                  layout={layout}
                  dispatch={dispatchLayout}
                  disabled={busy || navigating}
                />
              </div>
              <div
                className="document-quick-actions document-history"
                role="group"
                aria-label="Edit history"
              >
                <button
                  data-tooltip="Undo (Ctrl+Z)"
                  aria-label="Undo"
                  disabled={!active || busy || !documentUndo}
                  onClick={() => session.current?.doc.undo()}
                >
                  <ShellIcon name="undo" />
                </button>
                <button
                  data-tooltip="Redo (Ctrl+Y)"
                  aria-label="Redo"
                  disabled={!active || busy || !documentUndo}
                  onClick={() => session.current?.doc.redo()}
                >
                  <ShellIcon name="redo" />
                </button>
              </div>
              <ShellMenu
                label="Document actions"
                icon={<ShellIcon name="more" />}
                className="document-menu"
              >
                <div
                  className="document-action-group"
                  role="group"
                  aria-label="Open tools"
                >
                  <span className="document-action-heading">Open tools</span>
                  <button
                    aria-label="Browser"
                    aria-pressed={paneActive("browser")}
                    disabled={busy}
                    onClick={() => openSurface("browser")}
                  >
                    <ShellIcon name="globe" />
                    <span>Browser</span>
                  </button>
                  <button
                    aria-label="Card Deck"
                    aria-pressed={paneActive("cardDeck")}
                    disabled={!active || busy}
                    onClick={() => {
                      void run(async () => {
                        const cleaned =
                          await session.current?.enrollWorkspaceCards();
                        if (cleaned)
                          setNotice(
                            `Moved ${cleaned} empty ${cleaned === 1 ? "card" : "cards"} to Trash.`,
                          );
                        openSurface("cardDeck");
                      });
                    }}
                  >
                    <ShellIcon name="cardDeck" />
                    <span>Card Deck</span>
                  </button>
                  <button
                    aria-label="PDF reader"
                    disabled={!active || busy}
                    onClick={() => void run(() => openPdf())}
                  >
                    <ShellIcon name="highlight" />
                    <span>PDF reader</span>
                  </button>
                </div>
                <div
                  className="document-action-group"
                  role="group"
                  aria-label="Add content"
                >
                  <button
                    aria-label="Attach"
                    disabled={!active || busy}
                    onClick={() => file.current?.click()}
                  >
                    <ShellIcon name="attach" />
                    <span>Attach</span>
                  </button>
                  <button
                    aria-label="Links"
                    aria-pressed={paneActive("reference")}
                    disabled={!active || busy}
                    onClick={() => {
                      setLinksView("add");
                      openSurface("reference");
                    }}
                  >
                    <ShellIcon name="link" />
                    <span>Links</span>
                  </button>
                </div>
                <div
                  className="document-action-group"
                  role="group"
                  aria-label="Connections"
                >
                  <button
                    aria-label="Backlinks"
                    disabled={!active || busy}
                    onClick={() => {
                      openSurface("reference");
                      setLinksView("backlinks");
                      void run(scanBacklinks);
                    }}
                  >
                    <ShellIcon name="backlinks" />
                    <span>Backlinks</span>
                  </button>
                </div>
                <div
                  className="document-action-group"
                  role="group"
                  aria-label="Read & export"
                >
                  <button
                    aria-label="Export"
                    disabled={!active || busy}
                    onClick={() => setExporting(!exporting)}
                  >
                    <ShellIcon name="export" />
                    <span>Export</span>
                  </button>
                  <button
                    aria-label="Share as file"
                    disabled={!active || busy}
                    onClick={() =>
                      active && setSharing({ id: active.id, title: active.title })
                    }
                  >
                    <ShellIcon name="share" />
                    <span>Share as file…</span>
                  </button>
                </div>
                {!library && (
                  <div
                    className="document-action-group"
                    role="group"
                    aria-label="Quiz"
                  >
                    <button
                      aria-label="Reset quiz progress"
                      disabled={!active || busy || navigating}
                      onClick={() => setQuizReset(true)}
                    >
                      <ShellIcon name="refresh" />
                      <span>Reset quiz progress…</span>
                    </button>
                  </div>
                )}
                <div
                  className="document-action-group"
                  role="group"
                  aria-label="Trash"
                >
                  <button
                    aria-label="Delete document"
                    className="delete-document"
                    disabled={!active || busy}
                    onClick={() => active && requestTrash(active, "toolbar")}
                  >
                    <AnimatedTrash revision={trashAnimation.toolbar} />
                    <span>Move to Trash</span>
                  </button>
                </div>
              </ShellMenu>
            </>
          )}
        </header>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        <ToolSurface
          kind={surface}
          navigation={
            surface !== "workspace" && surface !== "trash" ? (
              <nav className="settings-nav" aria-label="Settings sections">
                <span className="settings-nav-label">Preferences</span>
                <button
                  disabled={busy}
                  aria-current={surface === "settings" ? "page" : undefined}
                  onClick={() => openSurface("settings")}
                >
                  <ShellIcon name="options" /> General
                </button>
                <button
                  disabled={busy}
                  aria-current={
                    surface === "editorSettings" ? "page" : undefined
                  }
                  onClick={() => openSurface("editorSettings")}
                >
                  <ShellIcon name="rename" /> Editor
                </button>
                <button
                  disabled={busy}
                  aria-current={surface === "aiSettings" ? "page" : undefined}
                  onClick={() => openSurface("aiSettings")}
                >
                  <ShellIcon name="sparkles" /> AI
                </button>
                <button
                  disabled={busy}
                  aria-current={surface === "updates" ? "page" : undefined}
                  aria-label={updateDot ? "Updates, update available" : undefined}
                  onClick={() => openSurface("updates")}
                >
                  <ShellIcon name="refresh" /> Updates
                  {updateDot && <span className="settings-nav-dot" aria-hidden="true" />}
                </button>
                <span className="settings-nav-label">Workspace</span>
                <button
                  disabled={busy}
                  aria-current={
                    surface === "workspaceSettings" ? "page" : undefined
                  }
                  onClick={() => openSurface("workspaceSettings")}
                >
                  <ShellIcon name="workspace" /> Workspace
                </button>
                <button
                  disabled={busy}
                  aria-current={surface === "backups" ? "page" : undefined}
                  onClick={() =>
                    void run(async () => {
                      openSurface("backups");
                      setBackupEntries(await backups.list());
                    })
                  }
                >
                  <ShellIcon name="backup" /> Backups
                </button>
                <span className="settings-nav-label">Advanced</span>
                <button
                  disabled={busy || !workspaceCatalog.active}
                  aria-current={surface === "integrity" ? "page" : undefined}
                  onClick={() => void run(checkWorkspace)}
                >
                  Workspace health
                </button>
                <button
                  disabled={busy || !workspaceCatalog.active}
                  aria-current={surface === "quarantine" ? "page" : undefined}
                  onClick={() => void run(loadCleanup)}
                >
                  File recovery
                </button>
              </nav>
            ) : undefined
          }
          title={surface ? surfaceTitles[surface] : ""}
          busy={busy}
          width={activePanelWidth}
          onWidth={setPanelWidth}
          onClose={closeSurface}
        >
          {surface === "editorSettings" && <EditorSettings />}
          {surface === "updates" && (
            <UpdatesSettings busy={busy} onInstall={installAppUpdate} />
          )}
          {surface === "aiSettings" && (
            <AiSettings
              enabled={aiEnabled}
              beforeReload={async () => {
                await session.current?.flush();
              }}
            />
          )}
          {surface === "settings" && (
            <section className="settings-page settings-overview">
              <h3>General</h3>
              <p className="settings-description">
                Make Knot feel like your space.
              </p>

              <div className="settings-row">
                <div>
                  <label htmlFor="note-view">
                    <strong>Open notes in</strong>
                  </label>
                  <p>
                    Choose how notes open from search, the sidebar, and Library.
                    Applies across workspaces on this device.
                  </p>
                </div>
                <select
                  id="note-view"
                  value={noteView}
                  onChange={(event) => {
                    const view = event.target.value as NoteView;
                    setNoteView(view);
                    updateNoteView(view);
                  }}
                >
                  <option value="page">Page</option>
                  <option value="edgeless">Canvas</option>
                </select>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Web links</strong>
                  <p>Choose where links from notes open.</p>
                </div>
                <select
                  aria-label="Open web links in"
                  value={linkPreference}
                  onChange={(event) => {
                    const preference = event.target.value as LinkPreference;
                    setLinkPreference(preference);
                    updateLinkPreference(preference);
                  }}
                >
                  <option value="knot">Knot</option>
                  <option value="external">Default browser</option>
                </select>
              </div>
              <div className="settings-row">
                <div>
                  <strong id="appearance-label">Appearance</strong>
                  <p>
                    Choose a theme. System follows your device’s appearance.
                  </p>
                </div>
                <div
                  className="appearance-switch"
                  role="group"
                  aria-labelledby="appearance-label"
                >
                  {(["system", "light", "dark"] as Appearance[]).map((mode) => (
                    <button
                      key={mode}
                      aria-pressed={appearance === mode}
                      onClick={() => {
                        setAppearance(mode);
                        updateAppearance(mode);
                      }}
                    >
                      {mode[0].toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Getting Started</strong>
                  <p>
                    Learn Knot with editable notes, a whiteboard, PDFs,
                    diagrams, and a small example project. Your changes are
                    yours to keep.
                  </p>
                </div>
                <div className="tour-actions">
                  <button
                    disabled={busy || !workspaceCatalog.active}
                    onClick={() => void openTour()}
                  >
                    {tour?.welcome_id
                      ? "Open Getting Started"
                      : "Add Getting Started"}
                  </button>
                  {!!tour?.version && (
                    <button
                      disabled={busy || !workspaceCatalog.active}
                      onClick={() => void openTour(true)}
                    >
                      Create fresh copy
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}
          {surface === "workspaceSettings" && (
            <section className="settings-page settings-overview">
              <h3>Workspace</h3>
              <p className="settings-description">
                Manage where your notes live.
              </p>
              <div className="settings-identity">
                <ShellIcon name="workspace" />
                <div>
                  <strong>
                    {workspaceCatalog.active
                      ? workspaceName(workspaceCatalog.active)
                      : "No workspace open"}
                  </strong>
                  <small>Local workspace · Stored on this device</small>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Workspace location</strong>
                  <p>
                    {workspaceCatalog.entries.find(
                      (entry) => entry.id === workspaceCatalog.active,
                    )?.path ?? "No workspace open"}
                  </p>
                  <p>
                    Creates and opens a copy in a new folder. The original stays
                    as a recovery copy; later edits are independent.
                  </p>
                </div>
                <button
                  disabled={busy || !workspaceCatalog.active}
                  onClick={() => void run(relocateWorkspace)}
                >
                  Relocate workspace
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Workspaces</strong>
                  <p>
                    Open an existing workspace or return to a recovery copy.
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() => setPickingWorkspace(true)}
                >
                  Manage workspaces
                </button>
              </div>
            </section>
          )}
          {surface === "backups" && (
            <section className="settings-page settings-backup-transfer">
              <h3>Backup files</h3>
              <p>
                Save an archive to another location, or restore a .knot file as
                a separate workspace.
              </p>
              <div className="settings-transfer-actions">
                {" "}
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await session.current?.flush();
                      const path = await backups.export();
                      if (path) setNotice(`Backup saved: ${path}`);
                    })
                  }
                >
                  Back up workspace
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (
                        !confirm(
                          "Restore a backup into a separate workspace and open it? Your current workspace will be retained.",
                        )
                      )
                        return;
                      await session.current?.flush();
                      const previous = workspaceIdentity.current;
                      const path = await backups.restore();
                      if (path) {
                        carrySidebarPreferences(
                          previous,
                          (await workspaces.catalog()).active,
                        );
                        await reloadWorkspace();
                        setNotice(`Opened restored workspace: ${path}`);
                      }
                    })
                  }
                >
                  Restore backup
                </button>
              </div>
            </section>
          )}
          {surface === "backups" && backupEntries === null && (
            <p>
              {busy
                ? "Loading backups…"
                : "Backups could not be loaded. Select Backups to retry."}
            </p>
          )}
          {exporting && active && (
            <section className="recovery-panel" aria-label="Export document">
              <p>
                Markdown exports page text and supported blocks, with
                attachments in a ZIP when needed. Canvas drawings are omitted;
                shared notes and document references remain links to workspace
                IDs, not portable copies.
              </p>
              <p>
                PNG and PDF capture the current Page or Canvas view. PDF is a
                single image-based page; text is not selectable. Embedded files
                and remote media may appear as cards. Keep a Knot backup for
                full fidelity.
              </p>
              <label>
                Format{" "}
                <select
                  aria-label="Export format"
                  disabled={busy}
                  value={exportFormat}
                  onChange={(e) =>
                    setExportFormat(e.target.value as ExportFormat)
                  }
                >
                  <option value="markdown">Markdown (.md / .zip)</option>
                  <option value="png">PNG image (.png)</option>
                  <option value="pdf">PDF snapshot (.pdf)</option>
                </select>
              </label>{" "}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const current = session.current;
                    if (!current) return;
                    await current.flush();
                    const files = await current.exportFiles(exportFormat);
                    const path = await exportDocument(
                      current.doc.meta?.title || title,
                      exportFormat,
                      files,
                    );
                    setNotice(
                      path ? `Export saved: ${path}` : "Export canceled.",
                    );
                  })
                }
              >
                Save export
              </button>{" "}
              <p>
                Choose a new filename; existing files are never overwritten.
                Maximum export: 100 MiB. Visual exports are limited to 16
                megapixels.
              </p>
            </section>
          )}
          {surface === "quarantine" && cleanup !== null && (
            <QuarantinePanel
              key={cleanupVersion}
              {...cleanup}
              busy={busy}
              onRefresh={() => void run(loadCleanup)}
              onDispose={(entry) =>
                void run(async () => {
                  if (
                    !confirm(
                      `Permanently delete the quarantine copy of ${entry.original} (${entry.size.toLocaleString()} bytes)? Recovery ID: ${entry.id}. This cannot be undone. Backups do not include this copy. Any restored original will remain.`,
                    )
                  )
                    return;
                  await session.current?.flush();
                  setIntegrity(null);
                  try {
                    const warning = await quarantine.dispose(entry);
                    setNotice(
                      `Permanently deleted the quarantine copy of ${entry.original} (${entry.size.toLocaleString()} bytes). ${warning ?? ""}`,
                    );
                  } finally {
                    await loadCleanup().catch(report);
                  }
                })
              }
              onMove={(selected) =>
                void run(async () => {
                  if (
                    !confirm(
                      `Quarantine ${selected.length} files (${selected.reduce((sum, c) => sum + c.size, 0).toLocaleString()} bytes)? Recovery copies stay in this workspace. No disk space will be freed.`,
                    )
                  )
                    return;
                  await session.current?.flush();
                  setIntegrity(null);
                  try {
                    const outcomes = await quarantine.move(
                      selected.map(({ id, size, digest }) => ({
                        id,
                        size,
                        digest,
                      })),
                    );
                    const failed = outcomes.filter((o) => o.error);
                    setNotice(
                      `Quarantined ${outcomes.length - failed.length} files. ${failed.length} failed. ` +
                        failed
                          .map(
                            (o) =>
                              `${selected.find((c) => c.id === o.id)?.path}: ${o.error}`,
                          )
                          .join(" "),
                    );
                  } finally {
                    await loadCleanup().catch(report);
                  }
                })
              }
              onRestore={(id) =>
                void run(async () => {
                  await session.current?.flush();
                  setIntegrity(null);
                  try {
                    await quarantine.restore(id);
                    setNotice(
                      "Restored file to its original location. The quarantine copy is retained.",
                    );
                  } finally {
                    await loadCleanup().catch(report);
                  }
                })
              }
            />
          )}
          {surface === "integrity" && !integrity && (
            <p>
              {busy ? "Checking workspace…" : "No report available."}{" "}
              <button disabled={busy} onClick={() => void run(checkWorkspace)}>
                Retry check
              </button>
            </p>
          )}
          {surface === "trash" && trash === null && (
            <p>
              {busy ? "Loading Trash…" : "Trash could not be loaded."}{" "}
              <button
                disabled={busy}
                onClick={() => void run(() => loadTrash())}
              >
                Retry Trash
              </button>
            </p>
          )}
          {surface === "integrity" && integrity !== null && (
            <IntegrityPanel
              report={integrity}
              onFiles={() => void run(loadCleanup)}
              busy={busy}
              onCheck={() => void run(checkWorkspace)}
              onRestoreTarget={(id) =>
                void run(() => restoreReferenceTarget(id))
              }
              onRecoverAttachment={(hash) =>
                void run(async () => {
                  await session.current?.flush();
                  try {
                    const source = await attachments.recoverMissing(hash);
                    setNotice(
                      `Recovered missing attachment from ${source}. The source copy is retained.`,
                    );
                    if (active) await select(active, false);
                  } finally {
                    await checkWorkspace();
                  }
                })
              }
              onBackups={() =>
                void run(async () => {
                  setBackupEntries(await backups.list());
                  openSurface("backups");
                })
              }
            />
          )}
          {surface === "backups" && backupEntries !== null && (
            <BackupManager
              entries={backupEntries}
              busy={busy}
              available={!!workspaceCatalog.active}
              onAction={(action, id) =>
                void run(async () => {
                  if (action === "create") {
                    await session.current?.flush();
                    const created = await backups.create();
                    setNotice(`Backup created: ${created}`);
                  } else if (action === "validate" && id) {
                    await backups.validate(id);
                    setNotice(
                      `Backup verified: ${id}. Database, relationships, and attachment hashes passed.`,
                    );
                  } else if (action === "delete" && id) {
                    if (
                      !confirm(
                        `Permanently delete backup “${id}”? This removes only this archive, not any workspace.`,
                      )
                    )
                      return;
                    await backups.delete(id);
                    setNotice(`Deleted backup: ${id}`);
                  } else if (action === "restore" && id) {
                    if (
                      !confirm(
                        "Restore this backup into a separate workspace and open it? Your current workspace will be retained.",
                      )
                    )
                      return;
                    await session.current?.flush();
                    const previous = workspaceIdentity.current;
                    const path = await backups.open(id);
                    carrySidebarPreferences(
                      previous,
                      (await workspaces.catalog()).active,
                    );
                    await reloadWorkspace();
                    setNotice(`Opened restored workspace: ${path}`);
                    return;
                  }
                  setBackupEntries(await backups.list());
                  openSurface("backups");
                })
              }
            />
          )}
          {pickingWorkspace && (
            <WorkspacePicker
              catalog={workspaceCatalog}
              busy={busy}
              onOpenExternal={() =>
                void run(async () => {
                  await session.current?.flush();
                  await flushChatSaves();
                  if (await workspaces.openExternal()) {
                    await reloadWorkspace();
                    setNotice("Opened workspace folder.");
                  }
                })
              }
              onRelocate={() => void run(relocateWorkspace)}
              onSwitch={(id) =>
                void run(async () => {
                  await session.current?.flush();
                  await flushChatSaves();
                  await workspaces.switch(id);
                  await reloadWorkspace();
                  setNotice(`Opened ${workspaceName(id)}.`);
                })
              }
            />
          )}
          {surface === "trash" && trash !== null && (
            <TrashPage
              deck={session.current?.cardDeck}
              items={trash}
              query={trashQuery}
              searched={trashSearch}
              busy={busy}
              more={moreTrash && trashQuery === trashSearch}
              onQuery={(value) => {
                setTrashQuery(value);
                void loadTrash(value).catch(report);
              }}
              onRestore={(item) => void run(() => restoreDocument(item))}
              onDelete={(item) =>
                setPurgeSelection({
                  ids: [item.id],
                  title: `Delete “${item.title}” permanently?`,
                })
              }
              onEmpty={() => void run(prepareEmptyTrash)}
              onMore={() => void run(() => loadTrash(trashSearch, true))}
              onHealth={() => void run(checkWorkspace)}
              onBackups={() =>
                void run(async () => {
                  openSurface("backups");
                  setBackupEntries(await backups.list());
                })
              }
            >
              {purgeSelection && (
                <TrashConfirmation
                  title={purgeSelection.title}
                  count={
                    purgeSelection.ids.length +
                    (purgeSelection.cards?.length ?? 0)
                  }
                  description="These items will be permanently deleted. Deleting collections keeps their notebooks. This cannot be undone."
                  onClose={() => setPurgeSelection(null)}
                  onConfirm={async () => {
                    await session.current?.flush();
                    let count = 0;
                    if (purgeSelection.cards?.length) {
                      // Save the emptied cards first so their attachments are
                      // released by the purge below.
                      count += session.current?.cardDeck.purge(purgeSelection.cards) ?? 0;
                      await session.current?.flush();
                    }
                    if (purgeSelection.ids.length)
                      count += await repository.purgeTrash(purgeSelection.ids);
                    setPurgeSelection(null);
                    setIntegrity(null);
                    setNotice(
                      `Permanently deleted ${count} ${count === 1 ? "item" : "items"}.`,
                    );
                    await run(async () => {
                      await loadTrash();
                      await refresh();
                      if (active) await select(active, false);
                    });
                  }}
                />
              )}
            </TrashPage>
          )}
        </ToolSurface>
        {notice && (
          <Notice
            key={noticeRevision}
            onDismiss={() => setNotice("")}
            duration={collectionUndo ? 10000 : 5000}
            busy={busy}
          >
            {notice}
            {collectionUndo && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const value = await collections.get(collectionUndo.id);
                    await collections.save(collectionUndo.id, {
                      collections: value.collections.filter(
                        (id) => id !== collectionUndo.collection,
                      ),
                    });
                    setCollectionUndo(null);
                    setNotice("Removed notebook from collection.");
                    await refresh();
                  })
                }
              >
                Undo collection assignment
              </button>
            )}
            {noticeAction && (
              <button
                disabled={busy}
                onClick={() => {
                  const action = noticeAction;
                  setNotice("");
                  action.run();
                }}
              >
                {noticeAction.label}
              </button>
            )}
            <button
              aria-label="Dismiss notification"
              data-tooltip="Dismiss notification"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </Notice>
        )}
        {library && (
          <LibraryPage
            onImport={() =>
              void knotbooks
                .choose()
                .then((token) => token && setImportToken(token))
                .catch(report)
            }
            preferenceKey={`${workspaceCatalog.active}:${library.library === "cardDeck" ? "library:cardDeck" : library.id}`}
            key={`${workspaceCatalog.active}:${library.library === "cardDeck" ? "library:cardDeck" : library.id}`}
            location={library}
            cardDeck={
              <LibraryCardDeck
                key={workspaceCatalog.active}
                workspace={workspaceCatalog.active ?? ""}
                revision={libraryRevision}
                cardId={library.cardId}
                onSelect={(cardId) =>
                  run(
                    () =>
                      openLibrary({
                        id: cardId
                          ? `library:cardDeck:card:${cardId}`
                          : "library:cardDeck",
                        library: "cardDeck",
                        cardId,
                      }),
                    true,
                  )
                }
                deck={session.current?.cardDeck}
                onCreateEditor={createLibraryCardEditor}
                onComposeMcq={(cardId) => {
                  void run(async () => {
                    const owner = await ensureLibraryCardSession();
                    const initial = cardId ? cardMcq(owner.cardDeck.data[cardId]) : undefined;
                    if (cardId && !initial) throw Error("This question is unavailable.");
                    setMcqComposer((open) => open ?? { cardId, initial, owner });
                  }, true);
                }}
                onFlush={() => session.current?.flush() ?? Promise.resolve()}
                onOpen={openLibraryCard}
                onPlace={placeLibraryCard}
                onTrash={trashLibraryCard}
                onTrashMany={(ids) => run(() => trashLibraryCards(ids), true)}
              />
            }
            catalog={catalog}
            busy={busy}
            run={run}
            onRenameNotebook={renameNotebook}
            onTrashNotebook={(item) => requestTrash(item)}
            onChanged={async () => {
              await reloadCollections();
              setLibraryRevision((v) => v + 1);
            }}
            onOpen={(item) => void run(() => select(item), true)}
            onNavigate={(location) =>
              void run(() => openLibrary(location), true)
            }
            onCreate={createNotebookAndWrite}
            onFavorite={toggleFavorite}
            revision={libraryRevision}
            sidebarDrag={sidebarDrag}
            pinned={sidebarPreferences.pinned}
            onTogglePin={sidebarPreferences.togglePin}
          />
        )}
        {transition && <ViewTransition {...transition} />}
        {documentLoading && (
          <div
            className="document-loading"
            role="status"
            aria-label="Loading notebook"
          >
            <div
              className="document-page-skeleton library-skeleton"
              aria-hidden="true"
            >
              <span className="library-skeleton-block document-page-title" />
              <span className="library-skeleton-block document-page-line" />
              <span className="library-skeleton-block document-page-line" />
              <span className="library-skeleton-block document-page-line short" />
            </div>
          </div>
        )}
        {aiEnabled && aiOpened && workspaceCatalog.active && (
          <>
            <div
              className="ask-workspace-host"
              ref={aiPageHost}
              hidden={aiPlacement !== "page"}
            />
            {createPortal(
              <AskKnot
                key={`${workspaceCatalog.active}:ask`}
                workspace={workspaceCatalog.active}
                documentId={active?.id ?? ""}
                initial={stableAiContext}
                suggestion={
                  session.current &&
                  suggestion?.context.instance === session.current.doc
                    ? suggestion
                    : null
                }
                onSuggestionHandled={() => setSuggestion(null)}
                onBusy={setAiRunning}
                onSource={async (document, block, text, pdf, video, image) => {
                  if (video) {
                    // A transcript citation: play that moment in the panel.
                    openVideoAt(video);
                    return;
                  }
                  const previousPlacement = aiPlacement;
                  let sourceFailed = false;
                  setAiPlacement("panel");
                  try {
                    if (image) {
                      await openCitedImage(document, image);
                      return;
                    }
                    if (document.startsWith("deck:")) {
                      const id = document.slice(5);
                      const deck = session.current?.cardDeck.data ??
                        JSON.parse(await repository.loadCardDeck()) as DeckData;
                      const card = deck[id];
                      if (!card || card.deleted)
                        throw Error(
                          "This card is no longer available. The captured excerpt is shown here.",
                        );
                      if (pdf) {
                        const refs = extractDeckPassages(
                          { id: document, title: "Card Deck", revision: "" },
                          card,
                        ).pdfs;
                        if (!refs.some((ref) => ref.key === pdf.key))
                          throw Error(
                            "The PDF is no longer attached to this card.",
                          );
                        await openPdf(pdf);
                        return;
                      }
                      if (!cardPreview(card, undefined, deck).includes(text))
                        throw Error(
                          "This card has changed. The captured excerpt is shown here.",
                        );
                      const workspace = workspaceIdentity.current;
                      const current = () =>
                        workspaceIdentity.current === workspace;
                      const catalog = await repository.catalog();
                      if (!current())
                        throw Error(
                          "Workspace changed while opening this source.",
                        );
                      const owners = [...catalog].sort(
                        (a, b) =>
                          Number(b.id === session.current?.doc.id) -
                            Number(a.id === session.current?.doc.id) ||
                          a.id.localeCompare(b.id),
                      );
                      const location = await findCardPlacement(
                        id,
                        owners.map((owner) => owner.id),
                        (owner) => {
                          const doc = session.current?.collection.getDoc(owner);
                          return doc?.root ? doc.spaceDoc : undefined;
                        },
                        repository.load,
                        current,
                      );
                      if (!current())
                        throw Error(
                          "Workspace changed while opening this source.",
                        );
                      if (location) {
                        // Resolve old saved citations too; canonical ownership is unchanged.
                        await selectCitation(
                          catalog.find(
                            (owner) => owner.id === location.document,
                          )!,
                        );
                        if (!current()) return;
                        const opened = session.current;
                        if (
                          !opened ||
                          opened.doc.id !== location.document ||
                          opened.doc.spaceDoc
                            .getMap<string>("knot:card-links")
                            .get(location.placement) !== id ||
                          !opened.doc.root?.children.some(
                            (note) => note.id === location.placement,
                          ) ||
                          !opened.cardDeck.data[id] ||
                          opened.cardDeck.data[id].deleted ||
                          !cardPreview(opened.cardDeck.data[id], undefined, opened.cardDeck.data).includes(text)
                        )
                          throw Error(
                            "The cited card placement has changed. The captured excerpt remains here.",
                          );
                        await focusCitedCard(opened, location.placement, text);
                        if (!current() || session.current !== opened) return;
                        openPane("ask");
                        return;
                      }
                      setCitedDeckSource({
                        workspace: workspaceCatalog.active!,
                        id,
                        text,
                      });
                      openSurface("cardDeck");
                      return;
                    }
                    if (block.startsWith("card:")) {
                      const [, placement, shared] = block.split(":");
                      const owner = (await repository.catalog()).find(
                        (row) => row.id === document,
                      );
                      const deck = session.current?.cardDeck.data ??
                        JSON.parse(await repository.loadCardDeck()) as DeckData;
                      const card = deck[shared];
                      if (
                        !owner ||
                        !card ||
                        card.deleted ||
                        !cardPreview(card, undefined, deck).includes(text)
                      )
                        throw Error(
                          "The cited card has changed or is unavailable. Its captured excerpt remains here.",
                        );
                      await selectCitation(owner);
                      const opened = session.current;
                      if (
                        !opened ||
                        opened.doc.id !== document ||
                        opened.doc.spaceDoc
                          .getMap<string>("knot:card-links")
                          .get(placement) !== shared ||
                        !opened.doc.root?.children.some(
                          (note) => note.id === placement,
                        )
                      )
                        throw Error(
                          "The cited card placement is no longer available.",
                        );
                      await focusCitedCard(opened, placement, text);
                      openPane("ask");
                      return;
                    }
                    if (pdf) {
                      const catalog = await repository.catalog();
                      if (!catalog.some((s) => s.id === document))
                        throw Error("Source is unavailable or deleted.");
                      const dirty = session.current
                        ?.topicOverlay()
                        .documents.find((row) => row.id === document);
                      const snapshot = dirty
                        ? dirty.snapshot
                        : await repository.load(document);
                      if (
                        !snapshot ||
                        !extractTopicContent(
                          { id: document, title: "", revision: "" },
                          snapshot,
                        ).pdfs.some(
                          // A sent-attachment chip names only the PDF, not its block.
                          (ref) =>
                            ref.key === pdf.key &&
                            (!block || ref.blockId === block),
                        )
                      )
                        throw Error(
                          "The PDF is no longer attached to this source.",
                        );
                      await openPdf(pdf);
                      return;
                    }
                    const source = (await repository.catalog()).find(
                      (item) => item.id === document,
                    );
                    if (!source)
                      throw new Error("Source is unavailable or deleted.");
                    const live =
                      session.current?.doc.id === document
                        ? session.current.doc
                        : null;
                    const snapshot = live
                      ? null
                      : await repository.load(document);
                    const blocks = live?.root
                      ? structuredAiBlocks(live.root)
                      : snapshot
                        ? JSON.parse(savedSearchText(document, snapshot, true))
                        : [];
                    const original = blocks.find(
                      (item: { id: string; text: string }) => item.id === block,
                    );
                    const equivalents = blocks.filter(
                      (item: { text: string }) => item.text.includes(text),
                    );
                    const target =
                      original ??
                      (equivalents.length === 1 ? equivalents[0] : undefined);
                    if (!target)
                      throw new Error(
                        "The cited paragraph is no longer available.",
                      );
                    if (!target.text.includes(text))
                      throw new Error(
                        "The cited paragraph has changed. The captured excerpt remains available here.",
                      );
                    await selectCitation(source);
                    openPane("ask");
                    const opened = session.current;
                    if (!opened || opened.doc.id !== document) return;
                    if (target.note)
                      await focusCitedCard(opened, target.note, text);
                    else {
                      await opened.setMode("page");
                      setMode(opened.editor.mode);
                      setFocusedNote(opened.revealedNoteId);
                    }
                    if (session.current !== opened) return;
                    requestAnimationFrame(() => {
                      const element = session.current?.editor.querySelector(
                        `[data-block-id="${CSS.escape(target.id)}"]`,
                      );
                      // A cited card was already revealed at the excerpt.
                      if (!target.note)
                        element?.scrollIntoView({
                          block: "center",
                          behavior: "smooth",
                        });
                      element?.animate(
                        [
                          { backgroundColor: "#ffe08a" },
                          { backgroundColor: "transparent" },
                        ],
                        { duration: 2400 },
                      );
                    });
                  } catch (error) {
                    sourceFailed = true;
                    setAiPlacement(previousPlacement);
                    throw error;
                  } finally {
                    if (
                      !sourceFailed &&
                      (contentArea.current?.parentElement?.clientWidth ??
                        1000) < 680
                    )
                      setAiPlacement("hidden");
                  }
                }}
                getSession={() => session.current}
                onClose={() => {
                  for (const tab of Object.values(layoutRef.current.tabs))
                    if (tab.kind === "ask")
                      dispatchLayout({ type: "close", id: tab.id });
                  setAiPlacement("hidden");
                }}
                placement={aiPlacement === "panel" ? "panel" : "page"}
                onPlacementChange={() =>
                  showAi(aiPlacement === "page" ? "panel" : "page")
                }
              />,
              aiContainer,
            )}
          </>
        )}
        <div
          className="workspace-content"
          ref={contentArea}
          style={library ? { display: "none" } : undefined}
        >
          <div
            aria-busy={busy || navigating || documentLoading || !!transition}
            style={documentLoading ? { visibility: "hidden" } : undefined}
            className={`editor-area${draggingFiles ? " file-drop-active" : ""}`}
            ref={host}
            onDragEnterCapture={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.stopPropagation();
              if (!active || locked.current || host.current?.inert) return;
              dragDepth.current++;
              setDraggingFiles(true);
            }}
            onDragOverCapture={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect =
                active && !locked.current && !host.current?.inert
                  ? "copy"
                  : "none";
            }}
            onDragLeaveCapture={(event) => {
              if (!dragDepth.current) return;
              event.stopPropagation();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setDraggingFiles(false);
            }}
            onDropCapture={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.stopPropagation();
              dragDepth.current = 0;
              setDraggingFiles(false);
              if (!active || locked.current || host.current?.inert) return;
              const files = Array.from(event.dataTransfer.files);
              const point = {
                x: event.clientX,
                y: event.clientY,
                afterId:
                  (event.target as Element)
                    .closest("[data-block-id]")
                    ?.getAttribute("data-block-id") ?? undefined,
              };
              if (files.length) void run(() => importFiles(files, point));
              else setError("Drop individual files rather than folders.");
            }}
          />
          {!library &&
            !active &&
            !busy &&
            !documentLoading &&
            aiPlacement !== "page" && (
              <section
                className="welcome"
                aria-labelledby="empty-workspace-heading"
              >
                <Mascot mood="write" />
                <h1 id="empty-workspace-heading">
                  A little space for big ideas.
                </h1>
                <p>Open a notebook or start something new.</p>
                <div className="welcome-actions">
                  <NewNotebook
                    busy={navigating}
                    run={run}
                    onCreate={createNotebookAndWrite}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void run(() => openLibrary(defaultLibrary), true)
                    }
                  >
                    <ShellIcon name="library" /> Open Library
                  </button>
                </div>
              </section>
            )}
          <WorkspacePanes
            expanded={browserExpanded && paneActive("browser")}
            layout={layout}
            dispatch={dispatchPaneAction}
            available={contentWidth}
            blocked={
              busy ||
              navigating ||
              documentLoading ||
              !!transition ||
              editorLoadFailed ||
              !!library ||
              !!surface
            }
            onReturn={() => {
              setBrowserExpanded(false);
              const el = invoker.current;
              if (el?.isConnected) el.focus();
              else
                session.current?.editor
                  .querySelector<HTMLElement>('[contenteditable="true"]')
                  ?.focus();
            }}
            label={(tab: PaneTab) =>
              tab.kind === "note"
                ? // Same name as the sidebar and the top bar ("Note 3" when empty).
                  (session.current?.doc.id === tab.documentId &&
                    session.current
                      ?.notebookNotes()
                      .find((note) => note.id === tab.noteId)?.title) ||
                  "Note"
                : tab.kind === "video"
                  ? videoReader?.title || surfaceTitles.video
                  : surfaceTitles[tab.kind]
            }
            contentKey={(tab) => tab.id}
            render={(tab) => (
              <>
                {tab.kind === "note" &&
                  session.current &&
                  session.current.doc.id === tab.documentId && (
                    <NotePagePane
                      session={session.current}
                      noteId={tab.noteId!}
                      aiEnabled={aiEnabled}
                      onAsk={(editor) => {
                        if (!workspaceCatalog.active || busy || navigating)
                          return;
                        setAiContext(
                          captureAiContext(
                            editor,
                            workspaceCatalog.active,
                            tab.noteId!,
                          ),
                        );
                        openSurface("ask");
                      }}
                    />
                  )}
                {tab.kind === "browser" && (
                  <BrowserPanel
                    workspace={workspaceCatalog.active}
                    request={browserRequest}
                    onNavigate={navigateBrowser}
                    expanded={browserExpanded}
                    onExpand={() => setBrowserExpanded((value) => !value)}
                    onClose={() => closePane(tab.id)}
                  />
                )}
                {tab.kind === "pdf" && !pdfReader?.sources.length && (
                  <p>Attach a PDF to this document first.</p>
                )}
                {tab.kind === "pdf" &&
                  pdfReader &&
                  pdfReader.sources.length > 0 &&
                  active && (
                    <Suspense fallback={<p>Loading PDF reader…</p>}>
                      <PdfReader
                        key={pdfReader.id}
                        sources={pdfReader.sources}
                        onAsk={
                          aiEnabled
                            ? (label, text, pdfSource) => {
                                const s = session.current;
                                if (!s || !workspaceCatalog.active) return;
                                setAiContext({
                                  pdf: true,
                                  pdfSource,
                                  workspace: workspaceCatalog.active,
                                  document: s.doc.id,
                                  instance: s.doc,
                                  version: "",
                                  label,
                                  text,
                                  ranges: [],
                                  structure: [],
                                  surrounding: [],
                                  note: null,
                                });
                                openSurface("ask", tab.id);
                              }
                            : undefined
                        }
                        onReplace={async (id, value) => {
                          if (!session.current)
                            throw new Error("Document is unavailable");
                          await session.current.replacePdfExcerpt(id, value);
                        }}
                        onDetach={async (citation) => {
                          if (!session.current)
                            throw new Error("Document is unavailable");
                          return session.current.detachPdfHighlight(citation);
                        }}
                        watchCitations={session.current?.watchPdfCitations}
                        onJump={(id) =>
                          void run(async () => {
                            await session.current?.focusCanvasCard(id);
                            setMode("edgeless");
                          })
                        }
                        initial={pdfReader.initial}
                        busy={busy}
                        onRemove={async (location, id) => {
                          let completed = false;
                          await run(async () => {
                            if (!session.current)
                              throw new Error("Document is unavailable");
                            await session.current.removePdfHighlight(
                              location,
                              id,
                            );
                            completed = true;
                          });
                          if (!completed)
                            throw new Error(
                              "Resolve the save error and retry.",
                            );
                        }}
                        onCreate={async (highlight) => {
                          let completed = false;
                          await run(async () => {
                            if (!session.current)
                              throw new Error("Document is unavailable");
                            await session.current.flush();
                            await session.current.pdfHighlight(highlight);
                            completed = true;
                          });
                          if (!completed)
                            throw new Error(
                              "Resolve the save error and retry.",
                            );
                        }}
                      />
                    </Suspense>
                  )}
                {tab.kind === "video" && !videoReader && (
                  <VideoResume
                    workspace={workspaceCatalog.active}
                    onResume={({ source, position }) => {
                      setVideoReader(source);
                      setVideoSeek(
                        position > 0
                          ? { ms: position, nonce: Date.now() }
                          : undefined,
                      );
                    }}
                  />
                )}
                {tab.kind === "video" &&
                  videoReader &&
                  workspaceCatalog.active && (
                    <Suspense fallback={<p>Loading video…</p>}>
                      <VideoReader
                        key={videoReader.videoId}
                        source={videoReader}
                        workspace={workspaceCatalog.active}
                        seek={videoSeek}
                      />
                    </Suspense>
                  )}
                {tab.kind === "cardDeck" &&
                  (session.current || documentLoading) && (
                    <CardDeckPanel
                      source={
                        citedDeckSource?.workspace === workspaceCatalog.active
                          ? citedDeckSource
                          : undefined
                      }
                      key={workspaceCatalog.active}
                      workspace={workspaceCatalog.active ?? ""}
                      canvas={session.current?.cardCanvas}
                      deck={
                        documentLoading ? undefined : session.current?.cardDeck
                      }
                      onPlace={async (id) => {
                        await session.current?.setMode("edgeless");
                        setMode("edgeless");
                        session.current?.placeCard(id);
                      }}
                    />
                  )}
                {tab.kind === "reference" &&
                  session.current &&
                  session.current.doc.id === tab.documentId && (
                  <LinksPanel
                    key={tab.documentId}
                    session={session.current}
                    notebooks={references}
                    mode={mode}
                    enabled={
                      paneActive("reference") && !busy && !navigating &&
                      !library && !surface && !documentLoading &&
                      !transition && !editorLoadFailed
                    }
                    view={linksView}
                    count={backlinks?.sources.length}
                    onView={(view) => {
                      setLinksView(view);
                      if (view === "backlinks" && !backlinks)
                        void run(scanBacklinks);
                    }}
                    onPlace={(target, placement) =>
                      void run(async () => {
                        const current = session.current;
                        if (current && current.doc.id === tab.documentId)
                          await current.placeNotebookLink(target, placement);
                      })
                    }
                  >
                    <BacklinksPanel
                      report={backlinks}
                      busy={busy}
                      onRefresh={() => void run(scanBacklinks)}
                      onOpen={(source) =>
                        void run(async () => {
                          await session.current?.flush();
                          const current = (await repository.catalog()).find(
                            (row) => row.id === source.id,
                          );
                          if (!current) {
                            setBacklinks(null);
                            throw new Error(
                              "This source is no longer available. Refresh backlinks.",
                            );
                          }
                          const location = backlinks?.locations?.[source.id];
                          await select(current);
                          if (location && session.current?.doc.id === source.id) {
                            await session.current.revealNotebookLink(location);
                            setMode(session.current.editor.mode);
                            setFocusedNote(session.current.revealedNoteId);
                          }
                        }, true)
                      }
                    />
                  </LinksPanel>
                )}
              </>
            )}
          />
        </div>
        {!library &&
          active &&
          mode === "edgeless" &&
          !(surface && managementSurfaces.has(surface)) &&
          !showSearch && (
            <CanvasRecovery
              disabled={busy || navigating}
              onFind={() => session.current?.findCanvasContent()}
            />
          )}
        {aiEnabled &&
          !library &&
          !busy &&
          !navigating &&
          !documentLoading &&
          !showSearch &&
          mode === "edgeless" &&
          !(surface && managementSurfaces.has(surface)) &&
          session.current &&
          workspaceCatalog.active && (
            <CanvasSuggestions
              key={JSON.stringify([workspaceCatalog.active, active?.id])}
              editor={session.current.editor}
              workspace={workspaceCatalog.active}
              disabled={aiRunning || !!suggestion}
              onStart={(id, action) => {
                const s = session.current;
                const card = s?.doc.getBlock(id)?.model;
                if (
                  !s ||
                  !workspaceCatalog.active ||
                  card?.flavour !== "affine:note" ||
                  aiRunning ||
                  suggestion
                )
                  return;
                const context = captureCardContext(
                  s.doc,
                  workspaceCatalog.active,
                  card,
                );
                if (
                  !qualifiedActions(
                    context.structure,
                    context.document,
                  ).includes(action)
                )
                  return;
                setAiContext(context);
                setSuggestion({ context, action });
                openSurface("ask");
              }}
            />
          )}{" "}
      </main>
      <input
        ref={file}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (selected.length) void run(() => importFiles(selected));
        }}
      />
    </div>
  );
}
