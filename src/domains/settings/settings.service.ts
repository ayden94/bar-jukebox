import { emit } from "../shared/bus";
import {
  DEFAULT_MAX_PER_DEVICE,
  DEFAULT_MAX_PER_TABLE,
  type SettingsRepository,
  type SettingsSnapshot,
} from "./settings.repository";

export class InvalidSettingsError extends Error {}

export class SettingsService {
  private requestsPaused = false;
  private notice = "";
  private maxPerDevice = DEFAULT_MAX_PER_DEVICE;
  private maxPerTable = DEFAULT_MAX_PER_TABLE;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly repository: Pick<SettingsRepository, "save">) {}

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

  update(patch: Partial<SettingsSnapshot>): Promise<void> {
    const input = { ...patch };
    const run = this.writeChain.then(async () => {
      const next = { ...this.read(), ...input };
      if (next.notice.length > 200) {
        throw new InvalidSettingsError("공지는 200자 이내로 입력해주세요");
      }
      for (const value of [next.maxPerDevice, next.maxPerTable]) {
        if (!Number.isInteger(value) || value < 0 || value > 99) {
          throw new InvalidSettingsError("곡 수 제한은 0~99 사이여야 해요");
        }
      }
      await this.repository.save(next);
      this.hydrate(next);
      emit("mutate");
    });
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
