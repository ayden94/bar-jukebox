import { useAdminSession } from "./session";
import { SongsTab } from "./songs-tab";

export default function AdminSongsPage() {
  const { act, api, snap } = useAdminSession();
  return <SongsTab act={act} api={api} snap={snap} />;
}
