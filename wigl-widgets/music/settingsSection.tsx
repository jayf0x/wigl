import { type SettingSection, useStorage } from "@/wigl/hooks";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  KEYS,
  MA_CONTAINER,
  MA_HOST,
  MA_PORT,
} from "./music.config";

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="flex items-center justify-between gap-3 py-1.5">
    <span className="flex flex-col">
      <span className="text-sm">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </span>
    {children}
  </label>
);

const MusicSettings = () => {
  const [host, setHost] = useStorage<string>(KEYS.host, MA_HOST);
  const [port, setPort] = useStorage<number>(KEYS.port, MA_PORT);
  const [username, setUsername] = useStorage<string>(KEYS.username, DEFAULT_USERNAME);
  const [password, setPassword] = useStorage<string>(KEYS.password, DEFAULT_PASSWORD);
  const [providerFilter, setProviderFilter] = useStorage<string>(KEYS.providerFilter, "");
  const [manageServer, setManageServer] = useStorage<boolean>(KEYS.manageServer, false);

  return (
    <div className="flex flex-col divide-y divide-border">
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
        <Input
          className="h-7 w-40 text-xs"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field
        label="Search provider"
        hint="Blank = all providers. e.g. radiobrowser, ytmusic"
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
  ],
  render: () => <MusicSettings />,
};

export default settingsSection;
