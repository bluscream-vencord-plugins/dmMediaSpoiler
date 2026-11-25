# DmMediaSpoiler

Equicord user plugin: locally covers DM media, stickers, text or emojis with spoilers while you might be showing your screen, so nothing private ends up on stream by accident.

## When it conceals

Any of these can be turned on in the settings:

- Discord's Streamer Mode is on.
- You're streaming in Discord.
- OBS Studio is streaming, and optionally recording or running its virtual camera, read through OBS WebSocket (`ws://127.0.0.1:4455` by default, with an optional password).
- A PipeWire screen capture is running, read from a small local helper (`http://127.0.0.1:28282` by default) that reports capture state.

Link previews are covered too. With text concealing on, a preview's title, description, author, footer and fields are hidden behind one spoiler. With link preview concealing on, so are previews whose author or footer has an icon; otherwise only the preview's image or video is covered.

It can also switch Discord's Streamer Mode on when one of these starts and off again when it ends. If you turn Streamer Mode off yourself during a stream, it stays off. The plugin remembers across reloads that it turned Streamer Mode on, so a crash mid stream doesn't leave it on for good.

## Connections

The OBS and PipeWire watchers retry when OBS or the helper isn't running, starting after 1 second (3 seconds for PipeWire status checks) and doubling the wait after every failure, with no upper limit. Once a connection works, the next retry starts from the shortest wait again.

A waiting retry runs right away when the Discord window gets focus or your Streamer Mode or stream changes, at most every 5 seconds. Changing the OBS address or password or the helper address reconnects at once.

If the connection drops while a stream or capture was active, the last state is kept for 15 seconds, so a restart of OBS or the helper doesn't briefly uncover DMs.

The OBS password is stored in the plugin's settings like any other setting, so it is included in settings exports and cloud sync.

## Install

```sh
cd src/userplugins
git clone https://github.com/bluscream-vencord-plugins/dmMediaSpoiler
```

Rebuild Equicord and enable DmMediaSpoiler. Update with `git pull`.
