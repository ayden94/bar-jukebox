export const admin = {
  root: "admin-root [--admin-gap:24px] min-h-dvh bg-[var(--admin-bg)] px-8 pt-6 pb-12 text-sm leading-normal text-[var(--admin-ink)] max-[640.001px]:px-4 max-[640.001px]:pt-4 max-[640.001px]:pb-8 max-[640.001px]:[--admin-gap:16px] [&_h1]:m-0 [&_h1]:text-[1.75rem] [&_h1]:leading-[1.3] [&_h1]:font-[750] [&_h1]:tracking-[-0.045em] max-[640.001px]:[&_h1]:text-2xl [&_h2]:m-0 [&_h2]:text-base [&_h2]:font-bold [&_h2]:tracking-[-0.02em] [&_h2]:text-[var(--admin-ink)] [&_input]:min-h-11 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-[10px] [&_input]:border [&_input]:border-[var(--admin-panel-border)] [&_input]:bg-[var(--admin-input-bg)] [&_input]:px-3 [&_input]:py-[11px] [&_input]:text-sm [&_input]:text-[var(--admin-ink)] [&_input]:outline-none [&_input::placeholder]:text-[var(--admin-muted)] [&_textarea]:block [&_textarea]:min-h-11 [&_textarea]:w-full [&_textarea]:min-w-0 [&_textarea]:resize-y [&_textarea]:rounded-[10px] [&_textarea]:border [&_textarea]:border-[var(--admin-panel-border)] [&_textarea]:bg-[var(--admin-input-bg)] [&_textarea]:px-3 [&_textarea]:py-[11px] [&_textarea]:text-sm [&_textarea]:text-[var(--admin-ink)] [&_textarea]:outline-none [&_textarea::placeholder]:text-[var(--admin-muted)] [&_:where(button,input,select,textarea,a,summary):focus-visible]:outline-2 [&_:where(button,input,select,textarea,a,summary):focus-visible]:outline-offset-3 [&_:where(button,input,select,textarea,a,summary):focus-visible]:outline-[var(--admin-accent)]",
  panel:
    "min-w-0 rounded-[var(--admin-radius)] border border-[var(--admin-panel-border)] bg-[var(--admin-panel)] p-6 max-[640.001px]:p-4.5",
  panelHead: "mb-5 flex items-center justify-between gap-3",
  count:
    "inline-flex items-center whitespace-nowrap rounded-md bg-[var(--admin-input-bg)] px-[9px] py-[3px] text-xs font-medium text-[var(--admin-muted)] tabular-nums",
  note: "mt-2 text-[0.8rem] leading-[1.6] text-[var(--admin-muted)] [overflow-wrap:anywhere]",
  empty: "px-3 py-7 text-center leading-[1.8] text-[var(--admin-muted)]",
  button:
    "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border-0 bg-[var(--admin-accent)] px-3.5 py-2.5 text-[0.8rem] leading-[1.3] font-[650] text-[var(--admin-accent-text)] no-underline transition-[filter,transform] duration-160 enabled:active:scale-97 enabled:hover:brightness-94 disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none",
  ghost: "!bg-[var(--admin-input-bg)] !text-[var(--admin-ink)]",
  danger:
    "!bg-[color-mix(in_srgb,var(--admin-red)_8%,transparent)] !text-[var(--admin-red)]",
  icon: "w-11 !p-0 text-base [&_svg]:size-6 [&_svg]:shrink-0",
  field: "m-0 flex items-stretch gap-2 [&_.admin-button]:shrink-0",
  fieldLabel: "mb-2 block text-[0.85rem] font-semibold text-[var(--admin-ink)]",
  pageHead:
    "mb-7 flex items-center justify-between gap-5 max-[640.001px]:mb-5 max-[640.001px]:flex-wrap max-[640.001px]:items-start [&_p]:mt-2 [&_p]:mb-0 [&_p]:text-[var(--admin-muted)] max-[640.001px]:[&_p]:text-[0.8rem]",
  stack: "grid min-w-0 gap-[var(--admin-gap)]",
} as const;
