import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Values to set in an INI file, by section then key. */
export type IniPatch = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** OBS's AMD H.264 encoder settings, as `streamEncoder.json` holds them. */
export interface AmfSettings {
  readonly rate_control: "CBR";
  readonly bitrate: number;
  readonly keyint_sec: number;
  readonly preset: "speed" | "balanced" | "quality";
  readonly profile: "high";
  readonly bf: number;
}

export interface SoakProfile {
  readonly ini: IniPatch;
  readonly encoder: AmfSettings;
}

/**
 * The soak profile's output settings, written while OBS is stopped because OBS reads them only
 * when it loads the profile. Advanced output mode, because Simple mode leaves the AMD encoder's
 * preset unset (its slowest, which an RX 580 cannot sustain at 1080p60) and its keyframe interval
 * at 250 frames, where Twitch wants 2 s.
 */
export function soakProfile(bitrate: number): SoakProfile {
  return {
    ini: {
      Output: { Mode: "Advanced", Reconnect: "true", RetryDelay: "2", MaxRetries: "1000" },
      AdvOut: {
        Encoder: "h264_texture_amf",
        ApplyServiceSettings: "false",
        Rescale: "false",
        TrackIndex: "1",
        AudioEncoder: "ffmpeg_aac",
        Track1Bitrate: "160",
      },
      Video: {
        BaseCX: "1920",
        BaseCY: "1080",
        OutputCX: "1920",
        OutputCY: "1080",
        FPSType: "2",
        FPSNum: "60",
        FPSDen: "1",
      },
    },
    encoder: {
      rate_control: "CBR",
      bitrate,
      keyint_sec: 2,
      preset: "speed",
      profile: "high",
      bf: 0,
    },
  };
}

/**
 * Writes the soak's output settings into the profile directory, `basic.ini` and
 * `streamEncoder.json`. Returns false when the profile does not exist yet: the monitor creates it
 * on first connect, and these settings apply from the next start.
 */
export function writeSoakProfile(profileDir: string, bitrate: number): boolean {
  const ini = join(profileDir, "basic.ini");
  if (!existsSync(ini)) return false;
  const profile = soakProfile(bitrate);
  writeFileSync(ini, patchIni(readFileSync(ini, "utf8"), profile.ini));
  writeFileSync(join(profileDir, "streamEncoder.json"), JSON.stringify(profile.encoder));
  return true;
}

/** `text` with each key in `patch` set in its section, adding sections and keys it lacks. */
export function patchIni(text: string, patch: IniPatch): string {
  const lines = text.replace(/^﻿/u, "").split(/\r?\n/u);
  const pending = new Map(
    Object.entries(patch).map(([section, keys]) => [section, new Map(Object.entries(keys))]),
  );
  const out: string[] = [];
  let section: string | undefined = undefined;
  const flush = () => {
    // Keys the section did not have go at its end.
    const rest = section === undefined ? undefined : pending.get(section);
    if (rest) for (const [key, value] of rest) out.push(`${key}=${value}`);
    if (section !== undefined) pending.delete(section);
  };
  for (const line of lines) {
    // A header starts a section; a key the patch names takes the patch's value; the rest stays.
    const header = /^\[(.+)\]$/u.exec(line.trim());
    if (header) {
      flush();
      section = header[1];
      out.push(line);
      continue;
    }
    const at = line.indexOf("=");
    const keys = section === undefined ? undefined : pending.get(section);
    const key = line.slice(0, at);
    const value = at > 0 ? keys?.get(key) : undefined;
    if (value === undefined) {
      out.push(line);
      continue;
    }
    out.push(`${key}=${value}`);
    keys?.delete(key);
  }
  flush();
  for (const [name, keys] of pending) {
    out.push(`[${name}]`, ...[...keys].map(([key, value]) => `${key}=${value}`));
  }
  return out.join("\r\n");
}
