import { type AdminDocumentProps, AdminDocumentShell } from "./document";
import { AdminSession, useAdminSession } from "./session";
import { SongsTab } from "./songs-tab";

function SongsPageContent() {
  const { act, snap } = useAdminSession();
  return <SongsTab act={act} snap={snap} />;
}

export function AdminSongsDocument(props: AdminDocumentProps) {
  return (
    <AdminDocumentShell
      page="admin-songs"
      title="주크박스 관리 · 노래 관리"
      {...props}
    >
      <AdminSession active="songs">
        <SongsPageContent />
      </AdminSession>
    </AdminDocumentShell>
  );
}
