import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import {
  CodeBlockLanguageSelector,
  EmojiSelector,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  Muya,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  TableColumnToolbar,
  TableDragBar,
  TableRowColumMenu,
} from '@muyajs/core';

type Props = {
  noteId: string;
  value: string;
  note: any;
  folders: any[];
  notebooks: any[];
  onChange: (nextValue: string) => void;
};

export type MuyaEditorHandle = {
  focus: () => void;
  hasFocus: () => boolean;
};

let muyaPluginsRegistered = false;
const ensureMuyaPlugins = () => {
  if (muyaPluginsRegistered) {
    return;
  }
  muyaPluginsRegistered = true;

  Muya.use(EmojiSelector);
  Muya.use(InlineFormatToolbar);
  Muya.use(ImageToolBar);
  Muya.use(ImageResizeBar);
  Muya.use(CodeBlockLanguageSelector);
  Muya.use(ParagraphFrontButton);
  Muya.use(ParagraphFrontMenu);
  Muya.use(TableColumnToolbar);
  Muya.use(ParagraphQuickInsertMenu);
  Muya.use(TableDragBar);
  Muya.use(TableRowColumMenu);
  Muya.use(PreviewToolBar);
};

const canCall = (obj: any, methodName: string) =>
  obj && typeof obj[methodName] === 'function';

const MuyaEditor = forwardRef<MuyaEditorHandle, Props>(
  ({ noteId, value, onChange, note, folders, notebooks }, ref) => {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const muyaRef = useRef<any>(null);
    const muyaDomRef = useRef<HTMLElement | null>(null);
    const lastKnownValueRef = useRef<string>(value);
    const lastEmittedValueRef = useRef<string | null>(null);

    const materializeForEditor = (markdown: string): string => {
      try {
        const resolveFn = window.electron?.resolveNoteAssetFileUrl;
        if (typeof resolveFn !== 'function') return markdown;
        return String(markdown ?? '').replace(
          /\]\(\s*(assets\/[^)\s]+)\s*\)/g,
          (_m, rel) => {
            const fileUrl = resolveFn({
              noteId,
              note,
              folders,
              notebooks,
              rel,
            });
            return fileUrl ? `](${fileUrl})` : `](${rel})`;
          }
        );
      } catch {
        return markdown;
      }
    };

    const normalizeForStorage = (markdown: string): string => {
      // Convert any absolute file://.../assets/<name> URLs back to assets/<name>.
      // This keeps links stable even when note folders are renamed/moved.
      return String(markdown ?? '').replace(
        /\]\(\s*file:\/\/\/?[^)\s]*\/assets\/([^)\s]+)\s*\)/g,
        (_m, name) => `](assets/${name})`
      );
    };

    const focus = () => {
      // Prefer Muya’s focus method if present; otherwise focus first focusable element.
      if (canCall(muyaRef.current, 'focus')) {
        muyaRef.current.focus();
        return;
      }
      const el = wrapperRef.current?.querySelector(
        '[contenteditable="true"]'
      ) as HTMLElement | null;
      el?.focus();
    };

    const hasFocus = () => {
      const root = wrapperRef.current;
      if (!root) return false;
      const active = document.activeElement;
      return !!active && root.contains(active);
    };

    useImperativeHandle(
      ref,
      () => ({
        focus,
        hasFocus,
      }),
      []
    );

    // Mount/recreate Muya when switching notes.
    useEffect(() => {
      ensureMuyaPlugins();

      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return;
      }

      // Reset wrapper and create a mount node. Muya replaces the mount node with
      // its own contenteditable container, so we must keep our own stable wrapper.
      wrapper.innerHTML = '';
      const mount = document.createElement('div');
      wrapper.appendChild(mount);

      const initialMarkdown = materializeForEditor(value ?? '');
      const muya = new Muya(mount, { markdown: initialMarkdown });
      muyaRef.current = muya;
      muyaDomRef.current = (muya as any)?.domNode ?? null;
      lastKnownValueRef.current = normalizeForStorage(value ?? '');
      lastEmittedValueRef.current = null;

      if (canCall(muya, 'init')) {
        muya.init();
      }

      // Ensure we propagate changes on every edit so the note list title can
      // update live while typing/backspacing (Muya may prevent native input events).
      let inputTimer: ReturnType<typeof setTimeout> | null = null;

      const exportMarkdown = (): string => {
        const muyaInst = muyaRef.current;
        const candidates = [
          'getMarkdown',
          'getMarkdownContent',
          'getContent',
          'exportMarkdown',
        ];
        for (const name of candidates) {
          if (canCall(muyaInst, name)) {
            try {
              const v = muyaInst[name]();
              if (typeof v === 'string') {
                return v;
              }
            } catch {
              // ignore
            }
          }
        }
        // Fallback: plaintext (ensures title updates even if we can't export markdown)
        const editable =
          wrapperRef.current?.querySelector('[contenteditable="true"]') ??
          wrapperRef.current;
        return (editable as HTMLElement | null)?.innerText ?? '';
      };

      const flushFromMuya = () => {
        const raw = String(exportMarkdown() ?? '');
        const nextValue = normalizeForStorage(raw);
        if (nextValue === lastKnownValueRef.current) return;
        lastKnownValueRef.current = nextValue;
        lastEmittedValueRef.current = nextValue;
        onChange(nextValue);
      };

      const scheduleFlush = () => {
        if (inputTimer) clearTimeout(inputTimer);
        inputTimer = setTimeout(flushFromMuya, 60);
      };

      const onInputCapture = (e: Event) => {
        // Ignore inputs outside this editor (we attach to document capture below).
        if (wrapperRef.current) {
          const targetNode =
            (e.target as Node | null) ??
            (document.activeElement as unknown as Node | null);
          if (targetNode && !wrapperRef.current.contains(targetNode)) {
            return;
          }
        }
        scheduleFlush();
      };

      // Muya emits internal change events even when it prevents default DOM input
      // (e.g., some backspace/delete behaviors). Listen to these so Redux stays
      // in sync and the note list title updates correctly.
      const onMuyaChange = () => scheduleFlush();
      if (canCall(muya, 'on')) {
        muya.on('json-change', onMuyaChange);
        muya.on('content-change', onMuyaChange);
      }

      const readAsDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

      const insertTextAtCursor = (text: string) => {
        focus();
        // Prefer execCommand because it triggers the same input pipeline Muya listens to.
        // (Deprecated but still widely supported in Electron.)
        try {
          if (document.queryCommandSupported?.('insertText')) {
            document.execCommand('insertText', false, text);
            return;
          }
        } catch {
          // ignore and fall back
        }

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) {
          return;
        }
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      };

      const saveDataUrlToAssets = async (mimeType: string, dataUrl: string) => {
        const saveFn = window.electron?.saveNoteAssetFromDataUrl;
        if (typeof saveFn !== 'function') {
          return null;
        }
        return (await saveFn({
          noteId,
          note,
          folders,
          notebooks,
          mimeType,
          dataUrl,
        })) as { rel: string; fileUrl: string } | null;
      };

      // Accept whitespace/newlines inside base64 (common when copying from some sources).
      const dataUrlRe =
        /data:image\/(png|jpeg|jpg|gif|webp);base64,[\sA-Za-z0-9+/=]+/g;

      const isHttpUrl = (s: string) => /^https?:\/\//i.test(s);
      const isFileUrl = (s: string) => /^file:\/\//i.test(s);
      const looksLikeAbsolutePath = (s: string) =>
        /^\//.test(s) || /^[a-zA-Z]:[\\/]/.test(s);
      const isImagePathLike = (s: string) =>
        /\.(png|jpe?g|gif|webp|svg)(?=$|[?#])/i.test(s);
      const isImageFile = (f: File | null | undefined) => {
        if (!f) return false;
        if (f.type && f.type.startsWith('image/')) return true;
        // Some clipboard providers leave `file.type` empty; fall back to extension.
        return /\.(png|jpe?g|gif|webp|svg)$/i.test(String(f.name || ''));
      };

      const saveUrlToAssets = async (url: string) => {
        const saveFn = window.electron?.saveNoteAssetFromUrl;
        if (typeof saveFn !== 'function') {
          return null;
        }
        return (await saveFn({
          noteId,
          note,
          folders,
          notebooks,
          url,
        })) as { rel: string; fileUrl: string } | null;
      };

      // Track handled paste events without mutating the event object (some
      // Chromium/Electron builds treat Event objects as non-extensible).
      const handledPasteEvents = new WeakSet<Event>();

      const takeOverPasteEvent = (e: ClipboardEvent) => {
        // Guard: ensure we never process the same paste event twice.
        if (handledPasteEvents.has(e)) return;
        handledPasteEvents.add(e);
        e.preventDefault();
        // Prevent Muya's own paste handler from running after we insert content.
        e.stopPropagation();
      };

      const onPasteCapture = async (e: ClipboardEvent) => {
        try {
          // Ignore pastes outside this editor (we attach to document capture below).
          if (wrapperRef.current) {
            const targetNode =
              (e.target as Node | null) ??
              (document.activeElement as unknown as Node | null);
            if (targetNode && !wrapperRef.current.contains(targetNode)) {
              return;
            }
          }
          const dt = e.clipboardData;
          if (!dt) return;
          const canSaveAssets =
            typeof window.electron?.saveNoteAssetFromDataUrl === 'function';

          const findImageFileFromDataTransfer = (): File | null => {
            // Some Electron/Chromium clipboard implementations expose the pasted image
            // via `clipboardData.files` rather than `clipboardData.items`.
            const files = Array.from((dt.files as unknown as FileList) ?? []);
            const imageFile = files.find((f) => isImageFile(f));
            return imageFile ?? null;
          };

          // 1) Prefer binary images from clipboard items.
          const items = Array.from(dt.items ?? []);
          const fileFromItems = (() => {
            for (const it of items) {
              if (it.kind !== 'file') continue;
              const f = it.getAsFile();
              if (isImageFile(f)) return f;
            }
            return null;
          })();

          if (fileFromItems) {
            const file = fileFromItems ?? findImageFileFromDataTransfer();
            if (!file) return;
            const mimeType =
              file.type ||
              (/\.jpe?g$/i.test(file.name || '')
                ? 'image/jpeg'
                : /\.gif$/i.test(file.name || '')
                  ? 'image/gif'
                  : /\.webp$/i.test(file.name || '')
                    ? 'image/webp'
                    : /\.svg$/i.test(file.name || '')
                      ? 'image/svg+xml'
                      : 'image/png');
            if (!canSaveAssets) return;
            // Take over synchronously before any async work so Muya never sees this paste.
            takeOverPasteEvent(e);
            const dataUrl = await readAsDataUrl(file);
            const saved = await saveDataUrlToAssets(mimeType, dataUrl);
            if (saved?.fileUrl) {
              insertTextAtCursor(`![pasted-image](${saved.fileUrl})`);
            } else {
              // In Electron, never store huge base64 in the note (it freezes and deforms titles).
              // If saving fails, keep content small and visible.
              insertTextAtCursor('[pasted image could not be saved]');
            }
            return;
          }

          // 1.25) Fallback: binary image in `clipboardData.files` without an image item.
          const fileOnlyImage = findImageFileFromDataTransfer();
          if (fileOnlyImage) {
            const mimeType =
              fileOnlyImage.type ||
              (/\.jpe?g$/i.test(fileOnlyImage.name || '')
                ? 'image/jpeg'
                : /\.gif$/i.test(fileOnlyImage.name || '')
                  ? 'image/gif'
                  : /\.webp$/i.test(fileOnlyImage.name || '')
                    ? 'image/webp'
                    : /\.svg$/i.test(fileOnlyImage.name || '')
                      ? 'image/svg+xml'
                      : 'image/png');
            if (!canSaveAssets) return;
            takeOverPasteEvent(e);
            const dataUrl = await readAsDataUrl(fileOnlyImage);
            const saved = await saveDataUrlToAssets(mimeType, dataUrl);
            if (saved?.fileUrl) {
              insertTextAtCursor(`![pasted-image](${saved.fileUrl})`);
            } else {
              insertTextAtCursor('[pasted image could not be saved]');
            }
            return;
          }

          // 1.35) Electron-native clipboard fallback: some apps don't populate
          // `clipboardData` with image bytes, but Electron can still read them.
          const readClipboardImageDataUrl =
            window.electron?.readClipboardImageDataUrl;
          if (typeof readClipboardImageDataUrl === 'function') {
            const nativeDataUrl = readClipboardImageDataUrl();
            if (nativeDataUrl && nativeDataUrl.startsWith('data:image/')) {
              if (!canSaveAssets) return;
              takeOverPasteEvent(e);
              const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(
                nativeDataUrl
              );
              const mimeType = mimeMatch?.[1] ?? 'image/png';
              const saved = await saveDataUrlToAssets(mimeType, nativeDataUrl);
              if (saved?.fileUrl) {
                insertTextAtCursor(`![pasted-image](${saved.fileUrl})`);
              } else {
                insertTextAtCursor('[pasted image could not be saved]');
              }
              return;
            }
          }

          // 1.5) Handle HTML paste that contains <img> tags (common when copying from the web).
          const html = dt.getData('text/html') ?? '';
          if (html && html.toLowerCase().includes('<img')) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const imgs = Array.from(doc.querySelectorAll('img'));
            if (imgs.length > 0) {
              // Decide synchronously whether we can handle at least one image.
              // If so, take over before any async I/O so Muya doesn't also paste.
              const hasSupportedImg = imgs.some((img) => {
                const src = (img.getAttribute('src') ?? '').trim();
                return (
                  src.startsWith('data:image/') ||
                  (src &&
                    (isHttpUrl(src) ||
                      isFileUrl(src) ||
                      (looksLikeAbsolutePath(src) && isImagePathLike(src))))
                );
              });
              if (!hasSupportedImg) {
                // Nothing we can handle; let Muya/default behavior proceed.
                return;
              }

              takeOverPasteEvent(e);
              const markdownParts: string[] = [];
              for (const img of imgs) {
                const src = (img.getAttribute('src') ?? '').trim();
                if (!src) continue;

                // data URL
                if (src.startsWith('data:image/')) {
                  const normalizedSrc = (() => {
                    const commaIdx = src.indexOf(',');
                    return commaIdx >= 0
                      ? src.slice(0, commaIdx + 1) +
                          src.slice(commaIdx + 1).replace(/\s+/g, '')
                      : src;
                  })();
                  const mimeMatch =
                    /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(
                      normalizedSrc
                    );
                  const mimeType = mimeMatch?.[1] ?? 'image/png';
                  if (!canSaveAssets) continue;
                  const saved = await saveDataUrlToAssets(
                    mimeType,
                    normalizedSrc
                  );
                  const alt = (img.getAttribute('alt') ?? 'pasted-image')
                    .trim()
                    .slice(0, 64);
                  if (saved?.fileUrl) {
                    markdownParts.push(`![${alt}](${saved.fileUrl})`);
                  } else {
                    // Avoid storing base64 in Electron notes.
                    markdownParts.push(`[${alt}]`);
                  }
                  continue;
                }

                // remote URL
                if (isHttpUrl(src)) {
                  const saved = await saveUrlToAssets(src);
                  const alt = (img.getAttribute('alt') ?? 'pasted-image')
                    .trim()
                    .slice(0, 64);
                  if (saved?.fileUrl) {
                    markdownParts.push(`![${alt}](${saved.fileUrl})`);
                  } else {
                    markdownParts.push(`![${alt}](${src})`);
                  }
                  continue;
                }

                // local file URL or absolute path
                if (
                  isFileUrl(src) ||
                  (looksLikeAbsolutePath(src) && isImagePathLike(src))
                ) {
                  const saved = await saveUrlToAssets(src);
                  const alt = (img.getAttribute('alt') ?? 'pasted-image')
                    .trim()
                    .slice(0, 64);
                  if (saved?.fileUrl) {
                    markdownParts.push(`![${alt}](${saved.fileUrl})`);
                  } else {
                    markdownParts.push(`![${alt}](${src})`);
                  }
                  continue;
                }
              }

              if (markdownParts.length > 0) {
                // Insert each image on its own line for readability and correct parsing.
                insertTextAtCursor(markdownParts.join('\n\n'));
                return;
              }
              // If we couldn't process any images, fall through to default behavior.
            }
          }

          // 2) Handle pasting text that includes data URLs (common when copying rendered HTML).
          const uriList = dt.getData('text/uri-list') ?? '';
          const text = dt.getData('text/plain') ?? '';
          const urlOnly = (uriList || text).trim();
          if (!urlOnly) return;

          const isSingleToken = !/\s/.test(urlOnly);

          // URL/path-only paste (common when copying an image link, dragging from web,
          // or copying a local image file path from the OS).
          if (isSingleToken) {
            if (isHttpUrl(urlOnly) && /^https?:\/\/\S+$/i.test(urlOnly)) {
              // try to store as asset and insert markdown image link
              const saved = await saveUrlToAssets(urlOnly);
              if (saved) {
                takeOverPasteEvent(e);
                insertTextAtCursor(
                  `![pasted-image](${saved.fileUrl || saved.rel})`
                );
                return;
              }
            }

            if (
              (isFileUrl(urlOnly) ||
                (looksLikeAbsolutePath(urlOnly) && isImagePathLike(urlOnly))) &&
              isImagePathLike(urlOnly)
            ) {
              const saved = await saveUrlToAssets(urlOnly);
              takeOverPasteEvent(e);
              insertTextAtCursor(
                `![pasted-image](${saved?.fileUrl || urlOnly})`
              );
              return;
            }
          }

          if (!text) return;

          const matches = text.match(dataUrlRe);
          if (!matches || matches.length === 0) return;

          // Take over synchronously before we start rewriting and inserting.
          takeOverPasteEvent(e);

          const originalTrimmed = text.trim();
          let nextText = text;
          for (const dataUrl of matches) {
            // Normalize whitespace within base64 payload.
            const commaIdx = dataUrl.indexOf(',');
            const normalized =
              commaIdx >= 0
                ? dataUrl.slice(0, commaIdx + 1) +
                  dataUrl.slice(commaIdx + 1).replace(/\s+/g, '')
                : dataUrl;
            const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(
              normalized
            );
            const mimeType = mimeMatch?.[1] ?? 'image/png';
            if (!canSaveAssets) continue;
            const saved = await saveDataUrlToAssets(mimeType, normalized);
            if (!saved) continue;
            nextText = nextText.replace(dataUrl, saved.fileUrl || saved.rel);
          }

          // If user pasted a raw data URL string, convert into a markdown image link.
          const nextTrimmed = nextText.trim();
          const pastedOnlyDataUrl = originalTrimmed.startsWith('data:image/');
          if (
            pastedOnlyDataUrl &&
            (nextTrimmed.startsWith('assets/') ||
              nextTrimmed.startsWith('file://'))
          ) {
            insertTextAtCursor(`![pasted-image](${nextTrimmed})`);
            return;
          }

          insertTextAtCursor(nextText);
        } catch {
          // If anything goes wrong, allow default paste behavior.
        }
      };

      // Attach to document capture so we still receive events even if Muya stops propagation.
      document.addEventListener('input', onInputCapture, true);
      document.addEventListener('paste', onPasteCapture, true);

      // Cleanup if supported.
      return () => {
        document.removeEventListener('input', onInputCapture, true);
        document.removeEventListener('paste', onPasteCapture, true);
        if (inputTimer) clearTimeout(inputTimer);
        if (canCall(muya, 'off')) {
          muya.off('json-change', onMuyaChange);
          muya.off('content-change', onMuyaChange);
        }
        if (canCall(muyaRef.current, 'destroy')) {
          muyaRef.current.destroy();
        }
        muyaRef.current = null;
        muyaDomRef.current = null;
      };
    }, [noteId]);

    // Keep Muya in sync if Redux updates the note content externally.
    useEffect(() => {
      const muya = muyaRef.current;
      if (!muya) return;

      const nextValue = normalizeForStorage(value ?? '');

      // If the update came from Muya itself, ignore.
      if (lastEmittedValueRef.current === nextValue) {
        return;
      }

      // Avoid resetting if it’s already in sync.
      if (lastKnownValueRef.current === nextValue) {
        return;
      }

      if (canCall(muya, 'setContent')) {
        muya.setContent(materializeForEditor(nextValue));
        lastKnownValueRef.current = nextValue;
        return;
      }

      if (canCall(muya, 'setMarkdown')) {
        muya.setMarkdown(materializeForEditor(nextValue));
        lastKnownValueRef.current = nextValue;
        return;
      }

      // Fallback: recreate on external changes if we can’t set content.
      // This is heavier but keeps correctness for things like preview checkbox toggles.
      const wrapper = wrapperRef.current;
      if (wrapper) {
        wrapper.innerHTML = '';
        const mount = document.createElement('div');
        wrapper.appendChild(mount);
        const replacement = new Muya(mount, {
          markdown: materializeForEditor(nextValue),
        });
        muyaRef.current = replacement;
        muyaDomRef.current = (replacement as any)?.domNode ?? null;
        lastKnownValueRef.current = nextValue;
        lastEmittedValueRef.current = null;
        canCall(replacement, 'init') && replacement.init();
      }
    }, [value]);

    const className = useMemo(() => 'muya-editor-root', []);

    return <div className={className} ref={wrapperRef} />;
  }
);

MuyaEditor.displayName = 'MuyaEditor';

export default MuyaEditor;
