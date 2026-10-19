import type { BrowserProviderFactory } from "../../../contracts/index";
import {
  type AppleMusicBrowserOptions,
  createMusicKitProvider,
} from "./factory";
import { loadMusicKit } from "./sdk-loader";

export const createAppleMusicBrowser: BrowserProviderFactory<
  AppleMusicBrowserOptions
> = (options, signal) => createMusicKitProvider(options, signal, loadMusicKit);
