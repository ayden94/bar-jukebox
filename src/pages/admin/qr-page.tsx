import { QrTab } from "./qr-tab";
import { useAdminSession } from "./session";

export default function AdminQrPage() {
  const { api } = useAdminSession();
  return <QrTab api={api} />;
}
