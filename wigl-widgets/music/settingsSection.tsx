import { useState } from "react";
import { type SettingSection, useStorage } from "@/wigl/hooks";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  KEYS,
  MA_CONTAINER,
  MA_HOST,
  MA_IMAGE,
  MA_PORT,
  SENDSPIN_OUTPUT,
} from "./music.config";
import { clearMaCache, type OpResult, restartMaContainer, updateMaImage } from "./serverProcess";

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="flex items-center justify-between gap-3 py-1.5">
    <span className="flex flex-col">
      <span className="text-sm">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </span>
    {children}
  </label>
);

/** H1 — run a docker op from Settings so the backend can be managed without a
 * terminal. `confirm` gates the disruptive ones behind a second click. */
const OpButton = ({ label, hint, run, confirm }: { label: string; hint: string; run: () => Promise<OpResult>; confirm?: boolean }) => {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    if (confirm && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy(true);
    setMsg(null);
    const r = await run();
    setBusy(false);
    setMsg(`${r.ok ? "✓ " : "✗ "}${r.message || (r.ok ? "done" : "failed")}`);
  };
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 flex-col">
        <span className="text-sm">{label}</span>
        <span className="truncate text-[11px] text-muted-foreground">{msg ?? hint}</span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={go}
        className={`mx-press shrink-0 rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50 ${busy ? "mx-pending-long" : ""}`}
      >
        {busy ? "…" : armed ? "confirm" : "run"}
      </button>
    </div>
  );
};

const MusicSettings = () => {
  const [host, setHost] = useStorage<string>(KEYS.host, MA_HOST);
  const [port, setPort] = useStorage<number>(KEYS.port, MA_PORT);
  const [username, setUsername] = useStorage<string>(KEYS.username, DEFAULT_USERNAME);
  const [password, setPassword] = useStorage<string>(KEYS.password, DEFAULT_PASSWORD);
  const [providerFilter, setProviderFilter] = useStorage<string>(KEYS.providerFilter, "");
  const [manageServer, setManageServer] = useStorage<boolean>(KEYS.manageServer, false);
  const [audioOutput, setAudioOutput] = useStorage<"direct" | "media-element">(
    KEYS.audioOutput,
    SENDSPIN_OUTPUT,
  );

  return (
    // `music-widget` scope so the shared .mx- motion classes reach the section
    // inside the app's settings modal; keep the modal's own type though.
    <div className="music-widget flex flex-col divide-y divide-border" style={{ fontFamily: "inherit" }}>
      <Field label="Server host">
        <Input
          className="h-7 w-40 text-xs"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder={MA_HOST}
        />
      </Field>
      <Field label="Server port">
        <Input
          className="h-7 w-40 text-xs"
          type="number"
          value={String(port)}
          onChange={(e) => setPort(Number(e.target.value) || MA_PORT)}
        />
      </Field>
      <Field label="Username">
        <Input
          className="h-7 w-40 text-xs"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="Password" hint="Localhost only — plain text in local storage.">
        <PasswordInput
          className="h-7 w-40 text-xs"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field
        label="Search provider"
        hint="Blank = all. e.g. radiobrowser, ytmusic_free"
      >
        <Input
          className="h-7 w-40 text-xs"
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value.trim())}
          placeholder="all"
        />
      </Field>
      <Field
        label="Auto-start server"
        hint={`Run "docker start ${MA_CONTAINER}" when the server is down.`}
      >
        <Switch checked={manageServer} onCheckedChange={setManageServer} />
      </Field>
      <Field
        label="Audio effects"
        hint="Routes audio through an <audio> element so the Effects tab (4-band EQ + reverb) works. The Effects tab flips this on for you. Off = lowest-latency direct output."
      >
        <Switch
          checked={audioOutput === "media-element"}
          onCheckedChange={(on) => setAudioOutput(on ? "media-element" : "direct")}
        />
      </Field>

      <p className="music-tag pt-3 pb-1 text-muted-foreground/60">Backend ({MA_CONTAINER})</p>
      <OpButton
        label="Restart server"
        hint="docker restart — quick, keeps all data"
        run={() => restartMaContainer(MA_CONTAINER)}
      />
      <OpButton
        label="Clear cache"
        hint="Wipes MA's image/proxy cache + old logs, then restarts. Library, playlists, and login are untouched."
        run={() => clearMaCache(MA_CONTAINER)}
      />
      <OpButton
        label="Update server"
        hint={`docker pull ${MA_IMAGE.split("/").pop()} + recreate. Can take a few minutes; playback drops while it runs.`}
        confirm
        run={() => updateMaImage(MA_CONTAINER, MA_IMAGE)}
      />
    </div>
  );
};

const settingsSection: SettingSection = {
  id: "music",
  label: "Music",
  fields: [
    { id: "music-host", label: "Server host", keywords: ["music assistant", "ip", "address"] },
    { id: "music-port", label: "Server port", keywords: ["music assistant", "8095"] },
    { id: "music-username", label: "Username", keywords: ["login", "auth"] },
    { id: "music-password", label: "Password", keywords: ["login", "auth"] },
    { id: "music-provider", label: "Search provider", keywords: ["radiobrowser", "youtube", "ytmusic", "filter"] },
    { id: "music-manage", label: "Auto-start server", keywords: ["docker", "container"] },
    { id: "music-fx", label: "Audio effects", keywords: ["eq", "equalizer", "reverb", "echo", "dsp"] },
    { id: "music-backend", label: "Backend controls", keywords: ["docker", "restart", "update", "cache", "clear"] },
  ],
  render: () => <MusicSettings />,
};

export default settingsSection;
