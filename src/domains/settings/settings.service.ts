import { emit } from "../shared/bus";
import type {
  SettingsRepository,
  SettingsSnapshot,
} from "./settings.repository";

export class SettingsService {
  private requestsPaused = false;
  private notice = "";

  constructor(private readonly repository: SettingsRepository) {}

  hydrate(snapshot: SettingsSnapshot): void {
    this.requestsPaused = snapshot.requestsPaused;
    this.notice = snapshot.notice;
  }

  read(): SettingsSnapshot {
    return { requestsPaused: this.requestsPaused, notice: this.notice };
  }

  isRequestsPaused(): boolean {
    return this.requestsPaused;
  }

  getNotice(): string {
    return this.notice;
  }

  setRequestsPaused(paused: boolean): void {
    this.requestsPaused = paused;
    emit("mutate");
    this.persist(this.repository.set("requests_paused", paused ? "1" : "0"));
  }

  setNotice(notice: string): void {
    this.notice = notice;
    emit("mutate");
    this.persist(this.repository.set("notice", notice));
  }

  private persist(task: Promise<void>): void {
    void task.catch((e) => console.error("settings persist failed:", e));
  }
}
