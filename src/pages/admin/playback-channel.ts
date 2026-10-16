export type PlaybackEvent = {
  event: string;
  data: unknown;
  id: string | null;
};

export type PlaybackFetcher = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export class PlaybackChannelError extends Error {
  constructor(readonly status: number) {
    super(`재생 연결을 열 수 없어요 (${status})`);
    this.name = "PlaybackChannelError";
  }
}

// URL이나 공개 EventSource에 관리자 토큰을 넣지 않아요.
export async function* playbackEvents(
  token: string,
  executorSessionId: string,
  signal: AbortSignal,
  fetcher: PlaybackFetcher = fetch,
): AsyncGenerator<PlaybackEvent, void> {
  signal.throwIfAborted();
  const query = new URLSearchParams({ executorSessionId });
  const response = await fetcher(`/api/admin/playback/events?${query}`, {
    headers: { "x-admin-token": token, Accept: "text/event-stream" },
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new PlaybackChannelError(response.status);
  if (!response.body) throw new Error("재생 연결 응답 본문이 없어요");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let line = "";
  let previousCR = false;
  let event = "";
  let id: string | null = null;
  let data: string[] = [];
  const completeLine = (): PlaybackEvent | null => {
    const current = line;
    line = "";
    if (current === "") {
      const message = data.length
        ? {
            event: event || "message",
            data: JSON.parse(data.join("\n")) as unknown,
            id,
          }
        : null;
      event = "";
      data = [];
      return message;
    }
    if (current.startsWith(":")) return null;
    const colon = current.indexOf(":");
    const field = colon === -1 ? current : current.slice(0, colon);
    let value = colon === -1 ? "" : current.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id" && !value.includes("\0")) id = value;
    return null;
  };
  let cancellation: Promise<void> | null = null;
  const cancel = () => {
    cancellation ??= reader.cancel().catch((error: unknown) => {
      if (!signal.aborted) throw error;
    });
    // fetch가 먼저 스트림을 오류로 닫아도 종료 처리에서 같은 Promise를 회수해요.
    void cancellation.catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done || signal.aborted) return;
      const text = decoder.decode(chunk.value, { stream: true });
      for (const character of text) {
        if (signal.aborted) return;
        if (previousCR) {
          previousCR = false;
          if (character === "\n") continue;
        }
        if (character === "\r" || character === "\n") {
          previousCR = character === "\r";
          const message = completeLine();
          if (message) yield message;
        } else {
          line += character;
        }
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    try {
      await cancellation;
    } finally {
      reader.releaseLock();
    }
  }
}
