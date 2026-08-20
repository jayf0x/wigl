import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Widget } from "@/wigl";
import { useStorage } from "@/wigl/hooks";
import { ExternalLink, Globe, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openInBrowser } from "./commands";
import { normalizeUrl } from "./urlUtils";

const WebsitesWidget = () => {
  // The committed, iframe-driving URL — persisted so the widget reopens on
  // the same site after a relaunch.
  const [url, setUrl] = useStorage<string>("url", "");
  // The address bar's own text, separate from `url` so typing doesn't
  // navigate the iframe on every keystroke — only on Enter.
  const [draft, setDraft] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Sites sending X-Frame-Options/frame-ancestors refuse the frame outright
  // — WebKit fires the iframe's error event for this (confirmed against a
  // real X-Frame-Options: SAMEORIGIN site), so show something instead of a
  // silent blank pane. Reset on every navigation attempt.
  const [blocked, setBlocked] = useState(false);

  // Keep the address bar in sync with the committed URL — covers the
  // initial storage read (arrives async, after first render) and external
  // changes (another window, the address-bar sync below).
  useEffect(() => setDraft(url), [url]);

  const navigate = () => {
    setBlocked(false);
    setUrl(normalizeUrl(draft));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") navigate();
  };
  const onClear = () => {
    setUrl("");
    setDraft("");
    setBlocked(false);
  };

  // ponytail: cross-origin frames throw/are inaccessible on read — that's a
  // browser security boundary, not a bug; the address bar just stays as-is.
  const onLoad = () => {
    try {
      const href = iframeRef.current?.contentWindow?.location.href;
      if (href && href !== "about:blank") setUrl(href);
    } catch {
      // cross-origin — can't read it, nothing to sync
    }
  };

  return (
    <Widget
      w={4}
      h={3}
      col={14}
      row={0}
      headerContent={
        <>
          <Input
            value={draft}
            onValueChange={setDraft}
            onKeyDown={onKeyDown}
            placeholder="enter a URL and hit enter"
            size="sm"
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            title="Open in browser"
            onClick={() => openInBrowser(url)}
            disabled={!url}
            className="opacity-50 hover:opacity-90"
          >
            <ExternalLink className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Clear"
            onClick={onClear}
            disabled={!url && !draft}
            className="opacity-50 hover:opacity-90"
          >
            <X className="size-3" />
          </Button>
        </>
      }
    >
      {url && !blocked ? (
        <iframe
          ref={iframeRef}
          src={url}
          onLoad={onLoad}
          onError={() => setBlocked(true)}
          className="w-full h-full border-0"
          title="website"
        />
      ) : url && blocked ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 text-center text-muted-foreground">
          <Globe className="size-6 opacity-40" />
          <span className="text-[11px] opacity-60">
            this site refuses to embed (X-Frame-Options) — use the ↗ button above to open it in your browser
          </span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Globe className="size-6 opacity-40" />
          <span className="text-[11px] opacity-60">enter a URL above</span>
        </div>
      )}
    </Widget>
  );
};

export default WebsitesWidget;
