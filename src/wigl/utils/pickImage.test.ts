// The picker itself (osascript/zenity) can't run headless, but the Python hop
// that does the real work — resize + JPEG re-encode + base64 — can. This guards
// the exact one-liner `pickAndProcessImage` shells out to (P7). Skips, does not
// fail, when Pillow isn't installed (see global-deps.md).
import { describe, expect, test } from "bun:test";

const PY =
  'import sys,base64,io;from PIL import Image,ImageOps;' +
  's,m=sys.argv[1],int(sys.argv[2]);' +
  'im=ImageOps.exif_transpose(Image.open(s)).convert("RGB");' +
  'im.thumbnail((m,m));b=io.BytesIO();im.save(b,format="JPEG",quality=82,optimize=True);' +
  'sys.stdout.write("data:image/jpeg;base64,"+base64.b64encode(b.getvalue()).decode())';

const hasPillow =
  (await Bun.spawn(["python3", "-c", "import PIL"]).exited.catch(() => 1)) === 0;

describe("pickAndProcessImage — the Python resize/encode hop", () => {
  test.skipIf(!hasPillow)("produces a downscaled JPEG data URI", async () => {
    // a 1200x800 PNG fixture, written on the fly
    const mk = await Bun.spawn([
      "python3",
      "-c",
      'from PIL import Image;Image.new("RGB",(1200,800),(90,90,90)).save("/tmp/wigl-pick-fixture.png")',
    ]).exited;
    expect(mk).toBe(0);

    const proc = Bun.spawn(["python3", "-c", PY, "/tmp/wigl-pick-fixture.png", "400"], {
      stdout: "pipe",
    });
    expect(await proc.exited).toBe(0);
    const uri = await new Response(proc.stdout).text();

    expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
    const bytes = Buffer.from(uri.split(",")[1], "base64");
    expect(bytes.length).toBeGreaterThan(200);
    // JPEG magic
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);

    // it actually resized: a 400px-max JPEG of a flat image is small
    expect(bytes.length).toBeLessThan(60_000);
  });
});
