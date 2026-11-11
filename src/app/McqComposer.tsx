import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  blankMcq,
  mcqError,
  mcqLimits,
  newMcqOption,
  readMcq,
  readMcqDraft,
  type McqDefinition,
} from "../features/quiz/mcq";
import {
  cardMcq,
  type CardDeck,
} from "../features/editor/blocksuite/card-deck";
import {
  McqEditConflict,
  PendingMcqSave,
} from "../features/editor/blocksuite/mcq-insertion";
import { quizRepository } from "../services/mcq";
import { ShellIcon } from "./ShellIcon";

type Draft = { question: McqDefinition; expected?: McqDefinition };
type Focus = (() => void) | undefined;
type Operation = () => Promise<Focus | void>;
type DraftStatus = "" | "Saving draft…" | "Draft saved" | "Couldn't save draft";

function parseDraft(raw: string): Draft {
  const value = JSON.parse(raw);
  const question = readMcqDraft(value?.question);
  const expected = readMcq(value?.expected);
  if (
    !question ||
    (value.version !== undefined && value.version !== 1) ||
    (value.expected !== undefined && !expected)
  )
    throw Error("The saved draft could not be read.");
  return { question, expected };
}

export function McqComposer({
  id,
  windowCloseDraft,
  initial,
  source,
  anchor,
  deck,
  notebookId,
  onSave,
  onInsert,
  onReload,
  onClose,
}: {
  id: string;
  windowCloseDraft?: MutableRefObject<(() => Promise<void>) | undefined>;
  initial?: McqDefinition;
  source?: McqDefinition["sources"][number];
  anchor?: DOMRect;
  deck?: CardDeck;
  notebookId?: string;
  standalone?: boolean;
  onSave: (
    question: McqDefinition,
    expected: McqDefinition | undefined,
    copy: boolean,
    another?: boolean,
  ) => Promise<Focus | void>;
  onInsert?: (id: string, operationId: string) => Promise<Focus | void>;
  onReload?: () => McqDefinition | undefined;
  onClose: (focus?: Focus) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const active = useRef(false);
  const locked = useRef(false);
  const dirty = useRef(false);
  const writes = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const base = useRef({ initial, source });
  const [draft, setDraft] = useState<Draft>();
  const [load, setLoad] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<DraftStatus>("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Operation>();
  const [conflict, setConflict] = useState(false);
  const [validate, setValidate] = useState(false);
  const [tab, setTab] = useState<"create" | "existing">("create");
  const [preview, setPreview] = useState(false);
  const [selected, setSelected] = useState("");
  const [checked, setChecked] = useState(false);
  const [added, setAdded] = useState(0);
  // Answer index to focus after the next render.
  const focusAnswer = useRef<{ index: number; end?: boolean }>();

  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    active.current = true;
    element.showModal();
    return () => {
      active.current = false;
      clearTimeout(timer.current);
      element.close();
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current!;
    const place = () => {
      element.style.inset = "";
      element.style.margin = "";
      if (!anchor || innerWidth < 600 || innerHeight < 450) return;
      const { width, height } = element.getBoundingClientRect();
      const gap = 8,
        margin = 12;
      const below = anchor.bottom + gap;
      const above = anchor.top - height - gap;
      const x = Math.max(
        margin,
        Math.min(anchor.left, innerWidth - width - margin),
      );
      const y = Math.max(
        margin,
        Math.min(
          below + height <= innerHeight - margin
            ? below
            : above >= margin
              ? above
              : below,
          innerHeight - height - margin,
        ),
      );
      element.style.inset = `${y}px auto auto ${x}px`;
      element.style.margin = "0";
    };
    const resize = new ResizeObserver(place);
    resize.observe(element);
    window.addEventListener("resize", place);
    place();
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  const freshDraft = () => {
    const { initial, source } = base.current;
    const question = initial ?? blankMcq();
    return {
      question: source ? { ...question, sources: [source] } : question,
      expected: initial,
    };
  };

  useEffect(() => {
    let cancelled = false;
    setError("");
    setLoadError(false);
    void quizRepository
      .loadDraft(id)
      .then((raw) => {
        if (cancelled) return;
        setDraft(raw ? parseDraft(raw) : freshDraft());
        setStatus(raw ? "Draft saved" : "");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(String(cause));
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, load]);

  useEffect(() => {
    if (draft && !preview && tab === "create") questionField.current?.focus();
  }, [!!draft, preview, tab]); // Focus only when returning to the form.

  useLayoutEffect(() => {
    const request = focusAnswer.current;
    if (!request) return;
    focusAnswer.current = undefined;
    const field = form.current?.querySelector<HTMLTextAreaElement>(
      `[aria-label="Option ${"ABCD"[request.index]}"]`,
    );
    field?.focus();
    if (field && request.end)
      field.setSelectionRange(field.value.length, field.value.length);
  });
  const focusOption = (index: number) => {
    focusAnswer.current = { index };
    setDraft((value) => (value ? { ...value } : value));
  };

  const store = (next: Draft) => {
    clearTimeout(timer.current);
    setStatus("Saving draft…");
    const write = writes.current
      .catch(() => {})
      .then(() =>
        quizRepository.saveDraft(id, JSON.stringify({ version: 1, ...next })),
      );
    writes.current = write;
    void write.then(
      () => {
        if (active.current && writes.current === write && !timer.current)
          setStatus("Draft saved");
      },
      () => {
        if (active.current && writes.current === write)
          setStatus("Couldn't save draft");
      },
    );
    timer.current = undefined;
    return write;
  };

  useLayoutEffect(() => {
    if (!windowCloseDraft) return;
    const flush = async () => {
      if (locked.current)
        throw Error("A question operation is still in progress.");
      if (draft && dirty.current && !pending) await store(draft);
    };
    windowCloseDraft.current = flush;
    return () => {
      if (windowCloseDraft.current === flush)
        windowCloseDraft.current = undefined;
    };
  });

  const update = (next: Draft) => {
    setDraft(next);
    setSelected("");
    setChecked(false);
    setStatus("Saving draft…");
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void store(next), 300);
  };
  const change = (value: Partial<McqDefinition>) => {
    if (draft && !locked.current && !pending)
      update({ ...draft, question: { ...draft.question, ...value } });
  };
  const perform = async (
    operation: Operation,
    saveDraft = true,
    closes = true,
  ) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (saveDraft && draft && !pending && dirty.current) await store(draft);
      const focus = await operation();
      if (closes) {
        dialog.current?.close();
        onClose(focus ?? undefined);
      }
    } catch (cause) {
      if (cause instanceof PendingMcqSave) setPending(() => operation);
      if (cause instanceof McqEditConflict) setConflict(true);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  // Closing keeps the draft for recovery.
  const close = () => {
    if (pending) return;
    void perform(async () => {}, true);
  };

  const validateForm = () => {
    if (!draft || !mcqError(draft.question)) return true;
    setValidate(true);
    requestAnimationFrame(() =>
      form.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus(),
    );
    return false;
  };
  const canAddAnother = !initial;
  const submit = (copy = false, another = false) => {
    if (pending) return void perform(pending, false);
    if (!draft || !validateForm()) return;
    if (!another)
      return void perform(() => onSave(draft.question, draft.expected, copy));
    void perform(
      async () => {
        await onSave(draft.question, draft.expected, false, true);
        // Publishing removed the stored draft; start the next question here.
        dirty.current = false;
        setDraft(freshDraft());
        setValidate(false);
        setPreview(false);
        setStatus("");
        setAdded((count) => count + 1);
        requestAnimationFrame(() => questionField.current?.focus());
      },
      true,
      false,
    );
  };

  const question = draft?.question;
  const emptyQuestion = validate && !question?.question.trim();
  const missingKey =
    validate &&
    !question?.options.some(({ id }) => id === question.correctOptionId);
  const answers =
    question?.options
      .map(({ text }) => text.trim().toLowerCase())
      .filter(Boolean) ?? [];
  const duplicates = new Set(answers).size < answers.length;
  const picker = tab === "existing" && deck && onInsert;
  const addAnswer = () => {
    if (!question || question.options.length >= 4) return;
    focusAnswer.current = { index: question.options.length };
    change({ options: [...question.options, newMcqOption()] });
  };
  const removeAnswer = (id: string) => {
    if (!question || question.options.length <= 2) return;
    change({
      options: question.options.filter((option) => option.id !== id),
      correctOptionId:
        question.correctOptionId === id ? "" : question.correctOptionId,
    });
  };
  // Paste one answer per line, e.g. a list copied from elsewhere.
  const pasteAnswers = (index: number, text: string) => {
    if (!question) return false;
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const free = question.options
      .slice(index)
      .every((option) => !option.text.trim());
    if (lines.length < 2 || index + lines.length > 4 || !free) return false;
    let correctOptionId = question.correctOptionId;
    const options = [...question.options];
    lines.forEach((line, offset) => {
      const option = options[index + offset] ?? newMcqOption();
      // Strip a list marker, then an optional checkbox ([x] = correct).
      const item = line.replace(/^(?:[-*\u2022]|\(?[A-Da-d1-4][.)])\s+/, "");
      const text = item
        .replace(/^\[[ xX]\]\s*/, "")
        .slice(0, mcqLimits.option);
      options[index + offset] = { id: option.id, text };
      if (/^\[[xX]\]/.test(item)) correctOptionId = option.id;
    });
    focusAnswer.current = { index: index + lines.length - 1, end: true };
    change({ options, correctOptionId });
    return true;
  };

  return (
    <dialog
      className="mcq-composer knot-dropdown"
      ref={dialog}
      aria-labelledby="mcq-compose-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          close();
          return;
        }
        if (
          event.key === "Enter" &&
          (event.ctrlKey || event.metaKey) &&
          !event.nativeEvent.isComposing &&
          !picker
        ) {
          event.preventDefault();
          submit(false, event.shiftKey && canAddAnother);
          return;
        }
        // Alt+1-4 marks the correct answer.
        const digit = /^Digit([1-4])$/.exec(event.code);
        if (
          digit &&
          event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          question &&
          !preview &&
          !picker
        ) {
          const option = question.options[Number(digit[1]) - 1];
          if (option) {
            event.preventDefault();
            change({ correctOptionId: option.id });
          }
        }
      }}
    >
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!picker) submit();
        }}
      >
        <header className="mcq-composer-header">
          <h2 id="mcq-compose-title">
            Multiple choice
            {added > 0 && (
              <small className="mcq-added" role="status">
                {added} added
              </small>
            )}
          </h2>
          {question && !picker && (
            <button
              type="button"
              className="mcq-quiet-action"
              disabled={busy || !!pending}
              onClick={() => {
                if (!preview && !validateForm()) return;
                setPreview(!preview);
              }}
            >
              {preview ? "Back to editing" : "Preview"}
            </button>
          )}
          <button
            type="button"
            aria-label="Close"
            disabled={busy || !!pending}
            onClick={() => close()}
          >
            <ShellIcon name="close" />
          </button>
        </header>
        {deck && !preview && (
          <div
            className="mcq-composer-tabs"
            role="tablist"
            aria-label="Question source"
            onKeyDown={(event) => {
              if (
                busy ||
                pending ||
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "create"
                  : event.key === "End"
                    ? "existing"
                    : tab === "create"
                      ? "existing"
                      : "create";
              setTab(next);
              dialog.current
                ?.querySelector<HTMLElement>(`#mcq-tab-${next}`)
                ?.focus();
            }}
          >
            {(["create", "existing"] as const).map((item) => (
              <button
                key={item}
                id={`mcq-tab-${item}`}
                type="button"
                role="tab"
                aria-controls="mcq-composer-body"
                aria-selected={tab === item}
                tabIndex={tab === item ? 0 : -1}
                disabled={busy || !!pending}
                onClick={() => setTab(item)}
              >
                {item === "create" ? "Create new" : "Insert existing"}
              </button>
            ))}
          </div>
        )}
        <div
          className="mcq-composer-body"
          id="mcq-composer-body"
          role={deck && !preview ? "tabpanel" : undefined}
          aria-labelledby={deck && !preview ? `mcq-tab-${tab}` : undefined}
        >
          {picker ? (
            <McqPicker
              deck={deck}
              notebookId={notebookId}
              disabled={busy || !!pending}
              onPick={(cardId) => {
                const operationId = crypto.randomUUID();
                void perform(() => onInsert(cardId, operationId));
              }}
            />
          ) : !question ? (
            loadError ? (
              <div className="mcq-recovery">
                <button
                  type="button"
                  onClick={() => setLoad((value) => value + 1)}
                >
                  Retry loading draft
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(freshDraft());
                    setError("");
                  }}
                >
                  Start a fresh draft
                </button>
              </div>
            ) : (
              <p role="status">Loading draft…</p>
            )
          ) : preview ? (
            <div className="knot-mcq">
              <fieldset disabled={checked}>
                <legend>{question.question}</legend>
                {question.options.map(({ id, text }, index) => (
                  <label key={id} className="mcq-choice">
                    <input
                      type="radio"
                      name="mcq-preview"
                      checked={selected === id}
                      onChange={() => setSelected(id)}
                    />
                    <span className="mcq-choice-text">
                      {"ABCD"[index]}. {text}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div aria-live="polite">
                {checked && (
                  <div className="mcq-feedback">
                    <strong className="mcq-result">
                      {selected === question.correctOptionId
                        ? "Correct"
                        : "Incorrect"}
                    </strong>
                    <p className="mcq-explanation">
                      The correct answer is{" "}
                      <b>
                        {question.options.map(({ id, text }, index) =>
                          id === question.correctOptionId
                            ? `${"ABCD"[index]}. ${text}.`
                            : null,
                        )}
                      </b>{" "}
                      <span className="mcq-explanation-copy">
                        {question.explanation}
                      </span>
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                className={checked ? "mcq-quiet-action" : "mcq-check-action"}
                disabled={!selected}
                onClick={() => {
                  if (checked) {
                    setChecked(false);
                    setSelected("");
                  } else setChecked(true);
                }}
              >
                {checked ? "Try again" : "Check answer"}
              </button>
            </div>
          ) : (
            <fieldset className="mcq-form-fields" disabled={busy || !!pending}>
              {initial && (
                <p className="mcq-hint">
                  Saving updates this question everywhere it appears.
                </p>
              )}
              <label className="mcq-field">
                Question
                <textarea
                  ref={questionField}
                  rows={2}
                  aria-label="Question"
                  maxLength={mcqLimits.question}
                  value={question.question}
                  aria-invalid={emptyQuestion || undefined}
                  aria-describedby={
                    emptyQuestion ? "mcq-error-question" : undefined
                  }
                  onChange={(event) => change({ question: event.target.value })}
                  onKeyDown={(event) => {
                    // Enter moves to the answers; Shift+Enter adds a line.
                    if (
                      event.key !== "Enter" ||
                      event.shiftKey ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.altKey ||
                      event.nativeEvent.isComposing
                    )
                      return;
                    event.preventDefault();
                    focusOption(0);
                  }}
                />
                {emptyQuestion && (
                  <small className="mcq-field-error" id="mcq-error-question">
                    Write a question.
                  </small>
                )}
              </label>
              <div className="mcq-answers" role="group" aria-label="Answers">
                <div className="mcq-answer-heading">
                  <span>Answers</span>
                  <small>Select a letter to mark it correct</small>
                </div>
                {question.options.map(({ id, text }, index) => {
                  const letter = "ABCD"[index],
                    invalid = validate && !text.trim(),
                    last = index === question.options.length - 1;
                  return (
                    <div key={id} className="mcq-option-editor">
                      <label
                        className="mcq-key"
                        data-tooltip={`Mark ${letter} correct (Alt+${index + 1})`}
                      >
                        <input
                          type="radio"
                          name="mcq-correct"
                          aria-label={`Mark option ${letter} as correct`}
                          aria-invalid={(missingKey && index === 0) || undefined}
                          aria-describedby={
                            missingKey ? "mcq-error-key" : undefined
                          }
                          checked={question.correctOptionId === id}
                          onChange={() => change({ correctOptionId: id })}
                        />
                        <span aria-hidden="true">{letter}</span>
                      </label>
                      <textarea
                        rows={1}
                        aria-label={`Option ${letter}`}
                        placeholder={`Answer ${letter}`}
                        maxLength={mcqLimits.option}
                        value={text}
                        aria-invalid={invalid || undefined}
                        aria-describedby={
                          invalid ? `mcq-error-${letter}` : undefined
                        }
                        onChange={(event) =>
                          change({
                            options: question.options.map((option) =>
                              option.id === id
                                ? { id, text: event.target.value }
                                : option,
                            ),
                          })
                        }
                        onPaste={(event) => {
                          if (
                            pasteAnswers(
                              index,
                              event.clipboardData.getData("text/plain"),
                            )
                          )
                            event.preventDefault();
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.nativeEvent.isComposing ||
                            event.ctrlKey ||
                            event.metaKey ||
                            event.altKey
                          )
                            return;
                          if (event.key === "Enter" && !event.shiftKey) {
                            // Next answer, a new one, or on to saving.
                            event.preventDefault();
                            if (!last) focusOption(index + 1);
                            else if (text.trim() && question.options.length < 4)
                              addAnswer();
                            else
                              form.current
                                ?.querySelector<HTMLElement>(
                                  ".mcq-composer-footer .primary",
                                )
                                ?.focus();
                          } else if (
                            event.key === "Backspace" &&
                            !text &&
                            question.options.length > 2
                          ) {
                            event.preventDefault();
                            focusAnswer.current = {
                              index: Math.max(0, index - 1),
                              end: true,
                            };
                            removeAnswer(id);
                          }
                        }}
                      />
                      {question.options.length > 2 ? (
                        <button
                          type="button"
                          className="mcq-remove-answer"
                          aria-label={`Remove option ${letter}`}
                          data-tooltip="Remove answer"
                          onClick={() => removeAnswer(id)}
                        >
                          <ShellIcon name="close" />
                        </button>
                      ) : (
                        <span />
                      )}
                      {invalid && (
                        <small
                          className="mcq-field-error"
                          id={`mcq-error-${letter}`}
                        >
                          Write an answer for {letter}.
                        </small>
                      )}
                    </div>
                  );
                })}
                {missingKey && (
                  <small className="mcq-field-error" id="mcq-error-key">
                    Mark one answer as correct.
                  </small>
                )}
                {duplicates && (
                  <p className="mcq-hint" role="status">
                    Some answers have the same text.
                  </p>
                )}
                {question.options.length < 4 && (
                  <button
                    type="button"
                    className="mcq-add-answer"
                    onClick={addAnswer}
                  >
                    <ShellIcon name="plus" /> Add answer
                  </button>
                )}
              </div>
              <details
                key={question.gradingRevision}
                open={question.explanation ? true : undefined}
              >
                <summary>
                  Explanation <small>(optional)</small>
                </summary>
                <textarea
                  rows={2}
                  aria-label="Explanation (optional)"
                  maxLength={mcqLimits.explanation}
                  value={question.explanation}
                  onChange={(event) =>
                    change({ explanation: event.target.value })
                  }
                />
              </details>
              {question.sources.length > 0 && (
                <details>
                  <summary>Source selection</summary>
                  {question.sources.map((item, index) => (
                    <blockquote key={index}>
                      {item.excerpt || item.notebookId}
                    </blockquote>
                  ))}
                </details>
              )}
            </fieldset>
          )}
          {error && (
            <p className="mcq-field-error" role="alert">
              {error}
            </p>
          )}
          {conflict && !pending && (
            <div className="mcq-recovery">
              <p className="mcq-hint">
                Reloading replaces this draft. Save as a new card to keep it.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const current = onReload?.();
                  if (!current)
                    return setError(
                      "The shared question is unavailable. Save as a new card to keep your draft.",
                    );
                  update({ question: current, expected: current });
                  setConflict(false);
                  setError("");
                }}
              >
                Reload current question
              </button>
              {initial && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submit(true)}
                >
                  Save as new card
                </button>
              )}
            </div>
          )}
        </div>
        {(!picker || status || pending) && (
          <footer className="mcq-composer-footer">
            <span role="status" className="mcq-hint">
              {status}
            </span>
            {status === "Couldn't save draft" && draft && !pending && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void store(draft)}
              >
                Retry draft
              </button>
            )}
            {pending ? (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void perform(pending, false)}
              >
                Retry save
              </button>
            ) : (
              draft &&
              !picker && (
                <>
                  {canAddAnother && !preview && (
                    <button
                      type="button"
                      className="mcq-another"
                      disabled={busy}
                      aria-keyshortcuts="Control+Shift+Enter"
                      data-tooltip="Save and start the next question (Ctrl+Shift+Enter)"
                      onClick={() => submit(false, true)}
                    >
                      Add another
                    </button>
                  )}
                <button
                  className="primary"
                  type="submit"
                  disabled={busy}
                  aria-keyshortcuts="Control+Enter"
                >
                  {busy
                    ? "Saving…"
                    : initial
                      ? "Save changes"
                      : deck
                        ? "Insert question"
                        : "Create card"}
                </button>
                </>
              )
            )}
          </footer>
        )}
      </form>
    </dialog>
  );
}

function McqPicker({
  deck,
  notebookId,
  disabled,
  onPick,
}: {
  deck: CardDeck;
  notebookId?: string;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [, refresh] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  useEffect(() => deck.subscribe(() => refresh((value) => value + 1)), [deck]);
  useEffect(() => {
    search.current?.focus();
  }, []);
  const questions = Object.values(deck.data).flatMap((card) => {
    const quiz = !card.deleted && cardMcq(card);
    return quiz ? [{ card, quiz }] : [];
  });
  const matches = questions.filter(({ quiz }) =>
    quiz.question.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const used = deck.placements(notebookId);
  return (
    <div
      className="mcq-picker"
      onKeyDown={(event) => {
        if (disabled || event.nativeEvent.isComposing) return;
        const buttons = Array.from(
          results.current?.querySelectorAll("button") ?? [],
        );
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (event.key === "ArrowDown" && buttons.length) {
          event.preventDefault();
          buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
        } else if (event.key === "ArrowUp" && index >= 0) {
          event.preventDefault();
          (buttons[index - 1] ?? search.current)?.focus();
        } else if (
          event.key === "Enter" &&
          document.activeElement === search.current &&
          matches.length
        ) {
          event.preventDefault();
          onPick(matches[0].card.id);
        }
      }}
    >
      <input
        type="search"
        ref={search}
        aria-label="Search questions"
        placeholder="Search questions"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!matches.length && (
        <p role="status">
          {questions.length
            ? "No matching questions."
            : "Card Deck has no multiple-choice questions yet."}
        </p>
      )}
      <ul ref={results} aria-label="Questions">
        {matches.map(({ card, quiz }) => (
          <li key={card.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(card.id)}
            >
              <span>
                <strong>{quiz.question}</strong>
                <small>
                  {quiz.options.map(({ text }) => text).join(" · ")}
                </small>
                {used.has(card.id) && <small>Already in this notebook</small>}
              </span>
              <span className="mcq-insert-label">Insert</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
