/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Everything this plugin matches against: Discord code, Discord data and the OBS and PipeWire protocols. */
export const PATTERNS = {
    webpack: {
        /** Discord's obscured-media wrapper (blur plus "click to reveal"). */
        spoilerComponent: ["shouldAgeVerify:", "isVerifiedTeen:"] as const,
        /** The message accessories renderer, which renders attachments and stickers. */
        accessoriesFind: "this.renderAttachments(",
        /** Start of renderAttachments(message){, capturing the message. */
        renderAttachments: /(?<=renderAttachments\((\i)\)\{)/,
        /** The one call site of the sticker renderer, capturing the message. */
        stickersCall: /(?<==)this\.renderStickersAccessories\((\i)\)/,
        /** The message content renderer. */
        contentFind: "!1,hideSimpleEmbedContent",
        /** The parsed content variable just before it is returned. */
        content: /(?<=let (\i)=\i;)(?=return null!=\i&&\(\1=\i\(\1,\i\)\),\1\})/,
        /** The module with Discord's obscure-reason helpers for embeds and attachments. */
        embedFind: "author.bot&&",
        /** The embed helper's "is a spoiler" flag right before it returns SPOILER. */
        embedSpoiler: /(?<=\.Embed,media:\i\},\i\);return .{0,80}?:)(\i)(?=\?\i\.\i\.SPOILER:null)/
    },

    /** AttachmentFlags.IS_SPOILER (1 << 3); Discord checks this flag rather than `attachment.spoiler`. */
    attachmentSpoilerFlag: 8,
    /** Attachment content types that count as images and videos. */
    mediaContentType: /^(?:image|video)\//,
    /** File names that count as images and videos when an attachment has no content type. */
    mediaFileName: /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v|mkv)$/i,

    /** Markdown AST node types. */
    ast: {
        spoiler: "spoiler",
        emojis: ["emoji", "customEmoji"] as readonly string[]
    },

    streamerModeUpdate: "STREAMER_MODE_UPDATE",

    obs: {
        defaultAddress: "ws://127.0.0.1:4455",
        protocols: ["ws:", "wss:"] as readonly string[],
        /** obs-websocket v5 opcodes. */
        op: { hello: 0, identify: 1, identified: 2, event: 5, request: 6, requestResponse: 7 },
        rpcVersion: 1,
        /** EventSubscription.General (1) | EventSubscription.Outputs (1 << 6). */
        eventSubscriptions: 1 | 1 << 6,
        /** Request type, its request id and the matching state-changed event, per output. */
        outputs: {
            stream: { request: "GetStreamStatus", id: "dmms-stream", event: "StreamStateChanged" },
            record: { request: "GetRecordStatus", id: "dmms-record", event: "RecordStateChanged" },
            virtualCam: { request: "GetVirtualCamStatus", id: "dmms-vcam", event: "VirtualcamStateChanged" }
        }
    },

    pipewire: {
        defaultUrl: "http://127.0.0.1:28282",
        protocols: ["http:", "https:"] as readonly string[],
        statusPath: "/status",
        eventsPath: "/events",
        trailingSlashes: /\/+$/
    }
};
