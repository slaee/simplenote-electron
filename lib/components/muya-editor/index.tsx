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

      if (canCall(muya, 'on')) {
        muya.on('change', (next: any) => {
          // Some builds emit markdown string; keep it flexible.
          const rawValue =
            typeof next === 'string'
              ? next
              : canCall(muya, 'getMarkdown')
                ? muya.getMarkdown()
                : '';
          const nextValue = normalizeForStorage(rawValue);
          lastKnownValueRef.current = nextValue;
          lastEmittedValueRef.current = nextValue;
          onChange(nextValue);
        });
      }

      // Ensure we propagate changes on every input so the note list title can
      // update live while typing (Muya's 'change' event may be batched).
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
        if (inputTimer) clearTimeout(inputTimer);
        inputTimer = setTimeout(flushFromMuya, 60);
      };

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
          // eslint-disable-next-line deprecation/deprecation
          if (document.queryCommandSupported?.('insertText')) {
            // eslint-disable-next-line deprecation/deprecation
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

      const saveDataUrlToAssets = (mimeType: string, dataUrl: string) => {
        const saveFn = window.electron?.saveNoteAssetFromDataUrl;
        if (typeof saveFn !== 'function') {
          return null;
        }
        return saveFn({
          noteId,
          note,
          folders,
          notebooks,
          mimeType,
          dataUrl,
        }) as { rel: string; fileUrl: string } | null;
      };

      // Accept whitespace/newlines inside base64 (common when copying from some sources).
      const dataUrlRe =
        /data:image\/(png|jpeg|jpg|gif|webp);base64,[\sA-Za-z0-9+/=]+/g;

      const isProbablyUrl = (s: string) => /^https?:\/\//i.test(s);

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

          const findImageFileFromDataTransfer = (): File | null => {
            // Some Electron/Chromium clipboard implementations expose the pasted image
            // via `clipboardData.files` rather than `clipboardData.items`.
            const files = Array.from((dt.files as unknown as FileList) ?? []);
            const imageFile = files.find(
              (f) => f && f.type?.startsWith('image/')
            );
            return imageFile ?? null;
          };

          // 1) Prefer binary images from clipboard items.
          const items = Array.from(dt.items ?? []);
          const imageItem = items.find((it) => it.type?.startsWith('image/'));
          if (imageItem) {
            const file =
              imageItem.getAsFile() ?? findImageFileFromDataTransfer();
            if (!file) return;
            const mimeType = file.type || 'image/png';
            e.preventDefault();
            const dataUrl = await readAsDataUrl(file);
            const saved = saveDataUrlToAssets(mimeType, dataUrl);
            if (!saved) return;
            insertTextAtCursor(`![pasted-image](${saved.rel})`);
            return;
          }

          // 1.25) Fallback: binary image in `clipboardData.files` without an image item.
          const fileOnlyImage = findImageFileFromDataTransfer();
          if (fileOnlyImage) {
            const mimeType = fileOnlyImage.type || 'image/png';
            e.preventDefault();
            const dataUrl = await readAsDataUrl(fileOnlyImage);
            const saved = saveDataUrlToAssets(mimeType, dataUrl);
            if (!saved) return;
            insertTextAtCursor(`![pasted-image](${saved.rel})`);
            return;
          }

          // 1.35) Electron-native clipboard fallback: some apps don't populate
          // `clipboardData` with image bytes, but Electron can still read them.
          const readClipboardImageDataUrl =
            window.electron?.readClipboardImageDataUrl;
          if (typeof readClipboardImageDataUrl === 'function') {
            const nativeDataUrl = readClipboardImageDataUrl();
            if (nativeDataUrl && nativeDataUrl.startsWith('data:image/')) {
              e.preventDefault();
              const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(
                nativeDataUrl
              );
              const mimeType = mimeMatch?.[1] ?? 'image/png';
              const saved = saveDataUrlToAssets(mimeType, nativeDataUrl);
              if (saved) {
                insertTextAtCursor(`![pasted-image](${saved.rel})`);
                return;
              }
            }
          }

          // 1.5) Handle HTML paste that contains <img> tags (common when copying from the web).
          const html = dt.getData('text/html') ?? '';
          if (html && html.toLowerCase().includes('<img')) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const imgs = Array.from(doc.querySelectorAll('img'));
            if (imgs.length > 0) {
              e.preventDefault();

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
                  const saved = saveDataUrlToAssets(mimeType, normalizedSrc);
                  if (saved) {
                    const alt = (img.getAttribute('alt') ?? 'pasted-image')
                      .trim()
                      .slice(0, 64);
                    markdownParts.push(`![${alt}](${saved.rel})`);
                  }
                  continue;
                }

                // remote URL
                if (isProbablyUrl(src)) {
                  const saved = await saveUrlToAssets(src);
                  if (saved) {
                    const alt = (img.getAttribute('alt') ?? 'pasted-image')
                      .trim()
                      .slice(0, 64);
                    markdownParts.push(`![${alt}](${saved.rel})`);
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
          const text = dt.getData('text/plain') ?? '';
          if (!text) return;

          // URL-only paste (common when copying an image link or dragging from web)
          const uriList = dt.getData('text/uri-list') ?? '';
          const urlOnly = (uriList || text).trim();
          if (isProbablyUrl(urlOnly) && /^https?:\/\/\S+$/i.test(urlOnly)) {
            // try to store as asset and insert markdown image link
            const saved = await saveUrlToAssets(urlOnly);
            if (saved) {
              e.preventDefault();
              insertTextAtCursor(`![pasted-image](${saved.rel})`);
              return;
            }
          }

          const matches = text.match(dataUrlRe);
          if (!matches || matches.length === 0) return;

          e.preventDefault();

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
            const saved = saveDataUrlToAssets(mimeType, normalized);
            if (!saved) continue;
            nextText = nextText.replace(dataUrl, saved.rel);
          }

          // If user pasted a raw data URL string, convert into a markdown image link.
          const nextTrimmed = nextText.trim();
          const pastedOnlyDataUrl = originalTrimmed.startsWith('data:image/');
          if (pastedOnlyDataUrl && nextTrimmed.startsWith('assets/')) {
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
        if (canCall(muyaRef.current, 'destroy')) {
          muyaRef.current.destroy();
        }
        muyaRef.current = null;
        muyaDomRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
