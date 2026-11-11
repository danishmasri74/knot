import { useEffect, useState } from "react";
import type { DocCollection } from "@blocksuite/store";
import {
  attachments,
  repository,
  type KnowledgeObject,
} from "../services/workspace";
import { Popover } from "./Collections";
import { PassagePicker, type Passage } from "./PassagePicker";
import { ShellIcon } from "./ShellIcon";

type ImageSource = { key: string; name: string };
export function AttachmentImage({ image }: { image: ImageSource }) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    void attachments
      .get(image.key)
      .then((bytes) => {
        if (!active) return;
        const data = new Uint8Array(bytes);
        objectUrl = URL.createObjectURL(
          new Blob([data], {
            type: /<svg[\s>]/i.test(
              new TextDecoder().decode(data.subarray(0, 4096)),
            )
              ? "image/svg+xml"
              : "",
          }),
        );
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.key]);
  return (
    <>
      <button
        type="button"
        className="ask-image-preview"
        title={image.name}
        aria-label={`Preview ${image.name}`}
        onClick={() => setPreview(true)}
      >
        {url ? <img src={url} alt={image.name} /> : <span>{image.name}</span>}
      </button>
      {preview && (
        <dialog
          ref={(element) => {
            if (element && !element.open) element.showModal();
          }}
          onCancel={() => setPreview(false)}
          className="ask-image-dialog"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setPreview(false);
            }
          }}
        >
          <button autoFocus onClick={() => setPreview(false)}>
            Close preview
          </button>
          <p>{image.name}</p>
          {url ? (
            <img src={url} alt={image.name} />
          ) : (
            <p>Image preview unavailable.</p>
          )}
        </dialog>
      )}
    </>
  );
}
export function ContextAttachments(props: {
  disabled: boolean;
  images: ImageSource[];
  collection?: DocCollection;
  onImage: (image: ImageSource) => void;
  onUpload: () => void;
  onNote: (note: KnowledgeObject) => void;
  onPassage: (passage: Passage) => void;
  onUrls: (urls: string[]) => void;
  onCurrent: () => void;
}) {
  const [notes, setNotes] = useState<KnowledgeObject[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void repository
      .catalog()
      .then(setNotes)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <Popover
      label="Add attachment"
      trigger={<ShellIcon name="plus" />}
      disabled={props.disabled}
    >
      {(close) => (
        <div
          className="ask-attachment-picker"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
            const buttons = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            if (!buttons.length) return;
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            e.preventDefault();
            buttons[
              index < 0
                ? e.key === "ArrowDown"
                  ? 0
                  : buttons.length - 1
                : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
            ]?.focus();
          }}
        >
          <PassagePicker
            choices={notes}
            collection={props.collection}
            onPick={(p) => {
              props.onPassage(p);
              close();
            }}
            onNote={(n) => {
              props.onNote(n);
              close();
            }}
            onUrls={(urls) => {
              props.onUrls(urls);
              close();
            }}
            browseActions={
              <div
                className="ask-picker-actions"
                role="group"
                aria-label="Quick attachments"
              >
                <button
                  type="button"
                  onClick={() => {
                    props.onUpload();
                    close();
                  }}
                >
                  <ShellIcon name="plus" /> Upload image...
                </button>
                <button
                  type="button"
                  onClick={() => {
                    props.onCurrent();
                    close();
                  }}
                >
                  <ShellIcon name="board" /> Current context
                </button>
              </div>
            }
            browseImages={
              props.images.length > 0 && (
                <section aria-labelledby="ask-picker-images-label">
                  <div
                    className="ask-picker-heading"
                    id="ask-picker-images-label"
                  >
                    Canvas images
                  </div>
                  <div className="ask-picker-images">
                    {props.images.map((image) => (
                      <button
                        type="button"
                        key={image.key}
                        title={image.name}
                        onClick={() => {
                          props.onImage(image);
                          close();
                        }}
                      >
                        <ImageThumb image={image} />
                      </button>
                    ))}
                  </div>
                </section>
              )
            }
          />
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </Popover>
  );
}
function ImageThumb({ image }: { image: ImageSource }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true,
      value = "";
    void attachments
      .get(image.key)
      .then((bytes) => {
        if (!active) return;
        const data = new Uint8Array(bytes);
        value = URL.createObjectURL(
          new Blob([data], {
            type: /<svg[\s>]/i.test(
              new TextDecoder().decode(data.subarray(0, 4096)),
            )
              ? "image/svg+xml"
              : "",
          }),
        );
        setUrl(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (value) URL.revokeObjectURL(value);
    };
  }, [image.key]);
  return url ? <img src={url} alt={image.name} /> : <span>{image.name}</span>;
}
