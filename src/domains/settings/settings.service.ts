import { emit } from "../shared/bus";
import {
  DEFAULT_MAX_PER_DEVICE,
  DEFAULT_MAX_PER_TABLE,
  type SettingsRepository,
  type SettingsSnapshot,
} from "./settings.repository";

export class SettingsService {
  private requestsPaused = false;
  private notice = "";
  private maxPerDevice = DEFAULT_MAX_PER_DEVICE;
  private maxPerTable = DEFAULT_MAX_PER_TABLE;

  constructor(private readonly repository: SettingsRepository) {}

  hydrate(snapshot: SettingsSnapshot): void {
    this.requestsPaused = snapshot.requestsPaused;
    this.notice = snapshot.notice;
    this.maxPerDevice = snapshot.maxPerDevice;
    this.maxPerTable = snapshot.maxPerTable;
  }

  read(): SettingsSnapshot {
    return {
      requestsPaused: this.requestsPaused,
      notice: this.notice,
      maxPerDevice: this.maxPerDevice,
      maxPerTable: this.maxPerTable,
    };
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

  setMaxPerDevice(count: number): void {
    this.maxPerDevice = count;
    emit("mutate");
    this.persist(this.repository.set("max_per_device", String(count)));
  }

  setMaxPerTable(count: number): void {
    this.maxPerTable = count;
    emit("mutate");
    this.persist(this.repository.set("max_per_table", String(count)));
  }

  private persist(task: Promise<void>): void {
    void task.catch((e) => console.error("settings persist failed:", e));
  }
}
