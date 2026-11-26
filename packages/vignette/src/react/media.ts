import { useLayoutEffect, useSyncExternalStore } from "react";

import type { Snapshot } from "../core/snapshot.js";
import type { TargetAudio } from "../target/status.js";
import type { DelayLine, PictureInput } from "../web-media/delay-line.js";
import type { AudioInput } from "../web-media/mixer.js";
import { createMediaSession, type MediaSession, type SourceMedia } from "../web-media/session.js";
import { useStreamContext } from "./context.js";

/**
 * The sound and delayed pictures of one `<Stream>`. Views register what they play and show; the
 * stages say which sources they show (`hear`). The media session behind it starts with the first
 * registration, so a stream without sound never creates an `AudioContext`, and server rendering
 * never touches Web Audio.
 */
export interface StreamMedia {
  /** Registers what a source's view plays and shows, until the returned function is called. */
  register(sourceId: string, media: SourceMedia): () => void;
  /** Marks the source as shown by a stage, so its sound is heard, until the returned function. */
  hear(sourceId: string): () => void;
  /**
   * How often the source became heard after being heard by no stage: the appearances of a
   * pictureless source, whose view no stage renders.
   */
  appearances(sourceId: string): number;
  /** Applies a new snapshot's channels and mix. */
  update(snapshot: Snapshot | undefined): void;
  delayLine(sourceId: string): DelayLine | undefined;
  /** Empties held frames of `sourceId`, or of every source, after a restart. */
  reset(sourceId?: string): void;
  resume(): Promise<void>;
  /** The stream's audio status, once something registered sound. */
  readonly status: TargetAudio | undefined;
  readonly output: MediaStream | undefined;
  subscribe(listener: () => void): () => void;
  /** Stops all sound; the next registration starts it again. */
  dispose(): void;
}

/** Creates the media of one `<Stream>`. */
export function createStreamMedia(): StreamMedia {
  const registered = new Map<string, SourceMedia>();
  const claims = new Map<string, number>();
  const appearances = new Map<string, number>();
  /** Sources no stage hears. A release only counts at the end of a commit, see `hear`. */
  const unheard = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: Snapshot | undefined = undefined;
  let session: MediaSession | undefined = undefined;
  let stopSession: (() => void) | undefined = undefined;
  let scheduled = false;

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function ensureSession(media: SourceMedia): void {
    if (session !== undefined) return;
    const element = media.video ?? (media.audio instanceof HTMLMediaElement ? media.audio : null);
    const document = element?.ownerDocument ?? globalThis.document;
    session = createMediaSession(document);
    stopSession = session.subscribe(notify);
    // The stream reports its audio status from now on.
    notify();
  }

  /** Converges the session once per task, however many views and stages changed. */
  function schedule(): void {
    if (scheduled || session === undefined) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (session === undefined || snapshot === undefined) return;
      const audible = new Set([...claims].flatMap(([id, count]) => (count > 0 ? [id] : [])));
      session.update({ sources: snapshot.sources, mix: snapshot.mix, audible, media: registered });
    });
  }

  return {
    register(sourceId, media) {
      ensureSession(media);
      registered.set(sourceId, media);
      schedule();
      return () => {
        if (registered.get(sourceId) === media) registered.delete(sourceId);
        schedule();
      };
    },
    hear(sourceId) {
      // A source no stage heard before, or none heard since the last commit, appears again.
      const count = claims.get(sourceId) ?? 0;
      claims.set(sourceId, count + 1);
      if (count === 0 && (unheard.has(sourceId) || !appearances.has(sourceId))) {
        unheard.delete(sourceId);
        appearances.set(sourceId, (appearances.get(sourceId) ?? 0) + 1);
        notify();
      }
      schedule();
      return () => {
        const left = (claims.get(sourceId) ?? 1) - 1;
        claims.set(sourceId, left);
        // A scene switch releases and claims again in one commit; only a source still unheard
        // after it left every shown scene.
        if (left === 0) {
          queueMicrotask(() => {
            if ((claims.get(sourceId) ?? 0) === 0) unheard.add(sourceId);
          });
        }
        schedule();
      };
    },
    appearances: (sourceId) => appearances.get(sourceId) ?? 0,
    update(next) {
      snapshot = next;
      schedule();
    },
    delayLine: (sourceId) => session?.delayLine(sourceId),
    reset: (sourceId) => session?.reset(sourceId),
    resume: async () => session?.resume(),
    get status() {
      return session?.status;
    },
    get output() {
      return session?.output;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      stopSession?.();
      session?.dispose();
      session = undefined;
      stopSession = undefined;
      notify();
    },
  };
}

/** What a source view plays and shows, as elements that may not be mounted yet. */
export interface SourceMediaElements {
  /** The element or stream the source's sound comes from; it stays muted, the mixer plays it. */
  readonly audio?: AudioInput | null;
  /** What the source shows, delayed while the channel's sync offset is negative. */
  readonly video?: PictureInput | null;
}

/**
 * Plays a source's sound through the stream's mixer, which applies its audio channel and hears
 * it only while a stage shows it, and lays a delay line over its picture while the channel's sync
 * offset is negative. For a custom view:
 *
 * ```tsx
 * const [video, setVideo] = useState<HTMLVideoElement | null>(null);
 * useSourceMedia(source.id, { audio: video, video });
 * return <video ref={setVideo} muted autoPlay />;
 * ```
 */
export function useSourceMedia(sourceId: string, { audio, video }: SourceMediaElements): void {
  const { client } = useStreamContext();
  const { media } = client;
  useLayoutEffect(() => {
    // Register once either element is mounted; a new element registers again.
    const input = audio ?? undefined;
    const picture = video ?? undefined;
    if (input === undefined && picture === undefined) return undefined;
    return media.register(sourceId, { audio: input, video: picture });
  }, [media, sourceId, audio, video]);
  const read = () => media.delayLine(sourceId);
  const line = useSyncExternalStore((listener) => media.subscribe(listener), read, read);
  useLayoutEffect(() => {
    // The delay line covers the picture in the box that holds it, while there is one.
    const box = video?.parentElement ?? undefined;
    if (line === undefined || box === undefined) return undefined;
    Object.assign(line.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    });
    box.append(line.canvas);
    return () => {
      line.canvas.remove();
    };
  }, [line, video]);
}

/** Marks `sourceId` as heard while `heard` is true and the component is mounted. */
export function useHeard(sourceId: string, heard: boolean): void {
  const { client } = useStreamContext();
  const { media } = client;
  useLayoutEffect(() => (heard ? media.hear(sourceId) : undefined), [media, sourceId, heard]);
}
