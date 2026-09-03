# wigl — allow player_queues/set_playback_speed for music tracks, not just
# audiobooks / podcast episodes.
#
# Music Assistant already time-stretches audio with ffmpeg `atempo` (wired
# through flow mode, crossfade and elapsed-time correction). It is gated to
# audiobooks by a single media_type check in
# `music_assistant/controllers/player_queues/controller.py` — a product
# choice, not a capability limit. This shim removes only that gate.
#
# It runs at interpreter start (sitecustomize on PYTHONPATH), before the MA
# webserver scans controller classes for `.api_cmd`, so the replacement method
# is the one that gets registered.
#
# Strategy: WRAP the original method rather than reimplement it — the only
# thing in the way is the media_type check, so we briefly present the current
# queue item as an audiobook, call the stock method, and restore the real
# media_type in a finally. That survives any MA change to the method body
# short of renaming the gate. Re-check after every `docker pull`.

try:
    from music_assistant_models.enums import MediaType
    from music_assistant.controllers.player_queues.controller import PlayerQueuesController

    _orig = PlayerQueuesController.set_playback_speed
    _SPEED_OK = (MediaType.AUDIOBOOK, MediaType.PODCAST_EPISODE)

    async def _set_playback_speed(self, queue_id, speed, queue_item_id=None):
        swapped = None
        try:
            data = self._queue_data.get(queue_id)
            queue = data.queue if data else None
            qid = queue_item_id or (
                queue.current_item.queue_item_id if queue and queue.current_item else None
            )
            item = self.get_item(queue_id, qid) if qid else None
            if item is not None and item.media_type not in _SPEED_OK:
                swapped = (item, item.media_type)
                item.media_type = MediaType.AUDIOBOOK
        except Exception:  # never let the shim break the real call
            swapped = None
        try:
            return await _orig(self, queue_id, speed, queue_item_id)
        finally:
            if swapped is not None:
                swapped[0].media_type = swapped[1]

    # carry the @api_command tags across so the startup scanner still registers it
    for _attr in (
        "api_cmd",
        "api_authenticated",
        "api_required_scope",
        "api_allow_impersonation",
        "api_alias",
    ):
        if hasattr(_orig, _attr):
            setattr(_set_playback_speed, _attr, getattr(_orig, _attr))

    PlayerQueuesController.set_playback_speed = _set_playback_speed
except Exception as exc:  # noqa: BLE001 — a broken shim must not stop the server
    import sys

    print(f"[wigl sitecustomize] playback-speed patch not applied: {exc}", file=sys.stderr)
