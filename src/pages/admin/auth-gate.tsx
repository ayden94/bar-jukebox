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
    <main className="admin-root admin-login">
      <form
        className="gate panel"
        onSubmit={(event) => {
          event.preventDefault();
          onLogin();
        }}
      >
        <div className="admin-brand">
          <span aria-hidden="true">♪</span> 주크박스
        </div>
        <h1>매장의 음악을 관리해요</h1>
        <p className="note">관리자 비밀번호로 로그인해요.</p>
        <label className="field-label" htmlFor="admin-password">
          관리자 비밀번호
        </label>
        <input
          id="admin-password"
          type="password"
          placeholder="관리자 비밀번호"
          autoComplete="current-password"
          required
          value={tokenInput}
          onChange={(e) => onTokenInput(e.currentTarget.value)}
        />
        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="btn"
          disabled={pending || !tokenInput.trim()}
          type="submit"
        >
          {pending ? "확인 중이에요" : "관리자 로그인"}
        </button>
        <p className="note gate-help">
          서버의 ADMIN_TOKEN에 설정된 비밀번호를 사용해요.
        </p>
      </form>
    </main>
  );
}
