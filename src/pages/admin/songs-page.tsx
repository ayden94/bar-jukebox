import { useAdminSession } from "./session";
import { SongsTab } from "./songs-tab";

export default function AdminSongsPage() {
  const { act, snap } = useAdminSession();
  return <SongsTab act={act} snap={snap} />;
}
