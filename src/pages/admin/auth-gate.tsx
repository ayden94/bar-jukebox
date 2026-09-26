type AuthGateProps = {
  tokenInput: string;
  onTokenInput: (value: string) => void;
  onLogin: () => void;
};

export function AuthGate({ tokenInput, onTokenInput, onLogin }: AuthGateProps) {
  return (
    <div className="admin-root">
      <div className="gate">
        <h1>🔒 주크박스 관리</h1>
        <input
          type="password"
          placeholder="관리자 비밀번호"
          value={tokenInput}
          onChange={(e) => onTokenInput((e.target as HTMLInputElement).value)}
        />
        <button className="btn" onClick={onLogin} type="button">
          들어가기
        </button>
        <div className="note">비밀번호는 서버 .env의 ADMIN_TOKEN입니다.</div>
      </div>
    </div>
  );
}
