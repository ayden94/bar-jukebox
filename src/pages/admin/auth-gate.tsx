import { admin } from "./styles";

type AuthGateProps = {
  tokenInput: string;
  onTokenInput: (value: string) => void;
  onLogin: () => void;
  pending: boolean;
  error: string;
};

export function AuthGate({
  tokenInput,
  onTokenInput,
  onLogin,
  pending,
  error,
}: AuthGateProps) {
  return (
    <main className={`${admin.root} grid place-items-center`}>
      <form
        className={`${admin.panel} w-[min(100%,420px)] !p-9 max-[640.001px]:!p-7`}
        onSubmit={(event) => {
          event.preventDefault();
          onLogin();
        }}
      >
        <div className="mb-7 flex items-center gap-1.5 whitespace-nowrap text-[1.1rem] font-extrabold tracking-[-0.04em] [&_span]:text-2xl [&_span]:text-[var(--admin-accent)]">
          <span aria-hidden="true">♪</span> 주크박스
        </div>
        <h1>매장의 음악을 관리해요</h1>
        <p className={`${admin.note} !mt-2.5 !mb-7`}>
          관리자 비밀번호로 로그인해요.
        </p>
        <label className={admin.fieldLabel} htmlFor="admin-password">
          관리자 비밀번호
        </label>
        <input
          className="mb-4"
          id="admin-password"
          type="password"
          placeholder="관리자 비밀번호"
          autoComplete="current-password"
          required
          value={tokenInput}
          onChange={(e) => onTokenInput(e.currentTarget.value)}
        />
        {error ? (
          <p className="text-[0.8rem] text-[var(--admin-red)]" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className={`${admin.button} admin-button w-full`}
          disabled={pending || !tokenInput.trim()}
          type="submit"
        >
          {pending ? "확인 중이에요" : "관리자 로그인"}
        </button>
        <p className={`${admin.note} !mt-5 !mb-0 text-xs`}>
          서버의 ADMIN_TOKEN에 설정된 비밀번호를 사용해요.
        </p>
      </form>
    </main>
  );
}
