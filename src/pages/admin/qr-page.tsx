import { type AdminDocumentProps, AdminDocumentShell } from "./document";
import { QrTab } from "./qr-tab";
import { AdminSession, useAdminSession } from "./session";

function QrPageContent() {
  const { api } = useAdminSession();
  return <QrTab api={api} />;
}

export function AdminQrDocument(props: AdminDocumentProps) {
  return (
    <AdminDocumentShell
      page="admin-qr"
      title="주크박스 관리 · QR 관리"
      {...props}
    >
      <AdminSession active="qr">
        <QrPageContent />
      </AdminSession>
    </AdminDocumentShell>
  );
}
