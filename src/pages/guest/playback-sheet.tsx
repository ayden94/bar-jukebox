import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

type PlaybackSheetProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
};

export function PlaybackSheet({ open, onClose, children }: PlaybackSheetProps) {
  const sheet = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [offset, setOffset] = useState<number | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    origin: number;
  } | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const dialog = sheet.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
      setVisible(true);
      return;
    }
    let cancelled = false;
    // 닫힘 전환이 끝날 때까지 모달과 배경 스크롤 잠금을 유지해요.
    void Promise.allSettled(
      dialog.getAnimations().map((animation) => animation.finished),
    ).then(() => {
      if (cancelled) return;
      dialog.close();
      setVisible(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!visible) return;
    const body = document.body;
    const html = document.documentElement;
    const { scrollX, scrollY } = window;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };
    const htmlOverflow = html.style.overflow;
    const scrollbar = window.innerWidth - html.clientWidth;
    Object.assign(body.style, {
      position: "fixed",
      top: `-${scrollY}px`,
      left: "0",
      right: "0",
      overflow: "hidden",
      paddingRight: `${
        parseFloat(getComputedStyle(body).paddingRight) + scrollbar
      }px`,
    });
    html.style.overflow = "hidden";
    return () => {
      Object.assign(body.style, previous);
      html.style.overflow = htmlOverflow;
      window.scrollTo({
        left: scrollX,
        top: scrollY,
        behavior: "instant",
      });
    };
  }, [visible]);

  const cancelDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    suppressClick.current = true;
    setOffset(null);
  };

  return (
    <dialog
      ref={sheet}
      className={`playback-sheet fixed inset-x-0 top-auto bottom-0 z-30 m-auto h-[min(94dvh,920px)] w-full max-w-160 overflow-y-auto rounded-t-[28px] border-0 bg-[var(--guest-surface)] px-6 pt-0 pb-[calc(30px+env(safe-area-inset-bottom))] text-[var(--guest-ink)] [overscroll-behavior:contain] transition-transform duration-480 ease-[var(--guest-ease)] motion-reduce:duration-[1ms] max-[420.001px]:px-4.5 ${
        open ? "is-open translate-y-0" : "pointer-events-none translate-y-full"
      } ${offset !== null ? "transition-none" : ""}`}
      style={
        offset === null ? undefined : { transform: `translateY(${offset}px)` }
      }
      aria-label="재생 화면"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        cancelDrag();
        onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        cancelDrag();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose();
        }
      }}
    >
      <div className="sticky top-0 z-1 -mx-6 flex min-h-15.5 items-center justify-center bg-[var(--guest-surface)] px-6 max-[420.001px]:-mx-4.5 max-[420.001px]:px-4.5">
        <button
          type="button"
          className="flex min-h-11 w-19 cursor-grab touch-none select-none items-center justify-center rounded-xl border-0 bg-transparent p-0 active:cursor-grabbing hover:brightness-115"
          aria-label="재생 화면 닫기"
          onClick={(event) => {
            if (event.detail === 0 || !suppressClick.current) {
              onClose();
            }
          }}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || !sheet.current) {
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            const origin = new DOMMatrixReadOnly(
              getComputedStyle(sheet.current).transform,
            ).m42;
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              origin,
            };
            suppressClick.current = false;
            setOffset(origin);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start || start.pointerId !== event.pointerId) {
              return;
            }
            if (
              Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6
            ) {
              suppressClick.current = true;
            }
            setOffset(Math.max(0, start.origin + event.clientY - start.y));
          }}
          onPointerUp={(event) => {
            const start = drag.current;
            if (!start || start.pointerId !== event.pointerId) {
              return;
            }
            drag.current = null;
            setOffset(null);
            if (
              suppressClick.current &&
              event.clientY > start.y &&
              start.origin + event.clientY - start.y >= 100
            ) {
              onClose();
            }
          }}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        >
          <span
            className="h-[5px] w-9.5 rounded-[99px] bg-[var(--guest-muted)] opacity-55"
            aria-hidden="true"
          />
        </button>
      </div>
      {children}
    </dialog>
  );
}
