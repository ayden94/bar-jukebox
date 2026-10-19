import { emit } from "../shared/bus";
import {
  type BackgroundRepository,
  type BackgroundSettings,
  DEFAULT_BACKGROUND,
} from "./background.repository";

export class InvalidBackgroundSettingsError extends Error {}

export class BackgroundService {
  private current: BackgroundSettings = { ...DEFAULT_BACKGROUND };
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: Pick<BackgroundRepository, "save">,
  ) {}

  hydrate(snapshot: BackgroundSettings): void {
    this.current = { ...snapshot };
  }

  read(): BackgroundSettings {
    return { ...this.current };
  }

  update(patch: Partial<BackgroundSettings>): Promise<void> {
    const input = { ...patch };
    const run = this.writeChain.then(async () => {
      const next = {
        ...this.current,
        ...input,
        playlist: (input.playlist ?? this.current.playlist).trim(),
      };
      if (next.playlist.length > 200) {
        throw new InvalidBackgroundSettingsError(
          "재생 목록 이름은 200자 이내로 입력해주세요",
        );
      }
      if (next.enabled && !next.playlist) {
        throw new InvalidBackgroundSettingsError(
          "배경 음악으로 쓸 재생 목록을 먼저 골라주세요",
        );
      }
      await this.repository.save(next);
      this.current = next;
      emit("mutate");
    });
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
