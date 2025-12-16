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
  ({ noteId, value, onChange }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const muyaRef = useRef<any>(null);
    const lastKnownValueRef = useRef<string>(value);
    const lastEmittedValueRef = useRef<string | null>(null);

    const focus = () => {
      // Prefer Muya’s focus method if present; otherwise focus first focusable element.
      if (canCall(muyaRef.current, 'focus')) {
        muyaRef.current.focus();
        return;
      }
      const el = containerRef.current?.querySelector(
        '[contenteditable="true"]'
      ) as HTMLElement | null;
      el?.focus();
    };

    const hasFocus = () => {
      const root = containerRef.current;
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

      const container = containerRef.current;
      if (!container) {
        return;
      }

      // Reset container.
      container.innerHTML = '';

      const muya = new Muya(container, { markdown: value ?? '' });
      muyaRef.current = muya;
      lastKnownValueRef.current = value ?? '';
      lastEmittedValueRef.current = null;

      if (canCall(muya, 'init')) {
        muya.init();
      }

      if (canCall(muya, 'on')) {
        muya.on('change', (next: any) => {
          // Some builds emit markdown string; keep it flexible.
          const nextValue =
            typeof next === 'string'
              ? next
              : canCall(muya, 'getMarkdown')
                ? muya.getMarkdown()
                : '';
          lastKnownValueRef.current = nextValue;
          lastEmittedValueRef.current = nextValue;
          onChange(nextValue);
        });
      }

      // Cleanup if supported.
      return () => {
        if (canCall(muyaRef.current, 'destroy')) {
          muyaRef.current.destroy();
        }
        muyaRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [noteId]);

    // Keep Muya in sync if Redux updates the note content externally.
    useEffect(() => {
      const muya = muyaRef.current;
      if (!muya) return;

      const nextValue = value ?? '';

      // If the update came from Muya itself, ignore.
      if (lastEmittedValueRef.current === nextValue) {
        return;
      }

      // Avoid resetting if it’s already in sync.
      if (lastKnownValueRef.current === nextValue) {
        return;
      }

      if (canCall(muya, 'setMarkdown')) {
        muya.setMarkdown(nextValue);
        lastKnownValueRef.current = nextValue;
        return;
      }

      // Fallback: recreate on external changes if we can’t set content.
      // This is heavier but keeps correctness for things like preview checkbox toggles.
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
        const replacement = new Muya(containerRef.current, {
          markdown: nextValue,
        });
        muyaRef.current = replacement;
        lastKnownValueRef.current = nextValue;
        lastEmittedValueRef.current = null;
        canCall(replacement, 'init') && replacement.init();
      }
    }, [value]);

    const className = useMemo(() => 'muya-editor-root', []);

    return <div className={className} ref={containerRef} />;
  }
);

MuyaEditor.displayName = 'MuyaEditor';

export default MuyaEditor;
