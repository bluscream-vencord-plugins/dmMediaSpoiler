# DmMediaSpoiler

Equicord user plugin: locally covers DM media, stickers, text or emojis with spoilers while you might be showing your screen, so nothing private ends up on stream by accident.

## When it conceals

Any of these can be turned on in the settings:

- Discord's Streamer Mode is on.
- You're streaming in Discord.
- OBS Studio is streaming, and optionally recording or running its virtual camera, read through OBS-WebSocket (`ws://127.0.0.1:4455` by default, with an optional password).
- A PipeWire screen capture is running, read from a small local helper (`http://127.0.0.1:28282` by default) that reports capture state.

It can also switch Discord's Streamer Mode on for you while one of these is active.

## Connections

The OBS and PipeWire watchers retry when OBS or the helper isn't running, starting after 1 second (3 seconds for PipeWire status checks) and doubling the wait after every failure, with no upper limit. Once a connection works, the next retry starts from the shortest wait again.

## Install

```sh
cd src/userplugins
git clone https://github.com/bluscream-vencord-plugins/dmMediaSpoiler
```

Rebuild Equicord and enable DmMediaSpoiler. Update with `git pull`.
