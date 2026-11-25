/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { migratePluginSetting } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { Channel, Message, MessageAttachment } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { ApplicationStreamingStore, ChannelStore, FluxDispatcher, MessageStore, SelectedChannelStore, StreamerModeStore } from "@webpack/common";
import type { ReactNode } from "react";

import { pluginInfo } from "./info";
import { startObsWatcher } from "./obs";
import { startPipewireWatcher } from "./pipewire";
import { registerWatchersCallback, settings } from "./settings";

export { pluginInfo };

interface SpoilerProps {
    type: "text" | "attachment" | "embed";
    inline?: boolean;
    children(hidden: boolean): ReactNode;
}

const Spoiler = findComponentByCodeLazy<SpoilerProps>("shouldAgeVerify:", "isVerifiedTeen:");

// Discord's AttachmentFlags.IS_SPOILER bitmask (1 << 3 = 8). Modern Discord checks
// `(attachment.flags ?? 0) & 8` in getObscureReason, rather than just `attachment.spoiler`.
const ATTACHMENT_FLAG_IS_SPOILER = 8;

type FlaggedAttachment = MessageAttachment & { flags?: number; };

migratePluginSetting(pluginInfo.name, "concealInStreamerMode", "onlyWhenStreamerModeEnabled");

let isPipewireStreaming = false;
let isObsStreaming = false;
let stopPipewire: (() => void) | null = null;
let stopObs: (() => void) | null = null;
let wasStreamerModeEnabledByPlugin = false;

function isAnyStreamingActive(): boolean {
    const {
        detectPipewireWatcher,
        detectObs,
        concealWhileStreaming,
    } = settings.store;

    return (detectPipewireWatcher && isPipewireStreaming)
        || (detectObs && isObsStreaming)
        || (concealWhileStreaming && ApplicationStreamingStore.getCurrentUserActiveStream() != null);
}

function updateDiscordStreamerMode() {
    if (!settings.store.forceDiscordStreamerMode) {
        if (wasStreamerModeEnabledByPlugin) {
            wasStreamerModeEnabledByPlugin = false;
            if (StreamerModeStore.enabled) {
                FluxDispatcher.dispatch({
                    type: "STREAMER_MODE_UPDATE",
                    key: "enabled",
                    value: false,
                });
            }
        }
        return;
    }

    const streaming = isAnyStreamingActive();
    if (streaming) {
        if (!StreamerModeStore.enabled) {
            wasStreamerModeEnabledByPlugin = true;
            FluxDispatcher.dispatch({
                type: "STREAMER_MODE_UPDATE",
                key: "enabled",
                value: true,
            });
        }
    } else if (wasStreamerModeEnabledByPlugin) {
        wasStreamerModeEnabledByPlugin = false;
        if (StreamerModeStore.enabled) {
            FluxDispatcher.dispatch({
                type: "STREAMER_MODE_UPDATE",
                key: "enabled",
                value: false,
            });
        }
    }
}

function shouldConcealMessageMedia(channel: Channel): boolean {
    const {
        concealInStreamerMode,
        concealWhileStreaming,
        includeGroupDms,
        detectPipewireWatcher,
        detectObs,
    } = settings.store;

    const externalActive = (detectPipewireWatcher && isPipewireStreaming)
        || (detectObs && isObsStreaming);

    const active = (concealInStreamerMode && StreamerModeStore.enabled)
        || (concealWhileStreaming && ApplicationStreamingStore.getCurrentUserActiveStream() != null)
        || externalActive;

    return active && (channel.isDM() || (includeGroupDms && channel.isGroupDM()));
}

// Forwarded message snapshots carry no channel_id, so fall back to the channel being viewed.
function shouldSpoilerEmbed(embed: Message["embeds"][number], message: Message): boolean {
    if (!settings.store.conceal.linkPreviews || (embed.image == null && embed.video == null && embed.thumbnail == null && !embed.images?.length)) return false;

    const channel = ChannelStore.getChannel(message.channel_id ?? SelectedChannelStore.getChannelId());
    return channel != null && shouldConcealMessageMedia(channel);
}

function shouldSpoilerStickers(message: Message, channel: Channel): boolean {
    return settings.store.conceal.stickers && message.stickerItems.length > 0 && shouldConcealMessageMedia(channel);
}

const isConcealedAttachment = (attachment: MessageAttachment) =>
    settings.store.conceal[/^(?:image|video)\//.test(attachment.content_type ?? "") ? "media" : "files"];

function withSpoilerAttachments(message: Message, channel: Channel): Message {
    if (!message.attachments.some(isConcealedAttachment) || !shouldConcealMessageMedia(channel)) return message;

    const spoilered = Object.create(message) as Message;
    spoilered.attachments = message.attachments.map((attachment: FlaggedAttachment) => isConcealedAttachment(attachment) ? {
        ...attachment,
        spoiler: true,
        flags: (attachment.flags ?? 0) | ATTACHMENT_FLAG_IS_SPOILER,
    } : attachment);
    return spoilered;
}

interface ASTNode {
    type: string;
    content?: string | ASTNode[];
    channelId?: string;
}

const spoilerNode = (content: ASTNode[], channelId: string): ASTNode => ({ type: "spoiler", content, channelId });

function spoilerEmojis(nodes: ASTNode[], channelId: string): ASTNode[] {
    return nodes.map(node =>
        node.type === "emoji" || node.type === "customEmoji" ? spoilerNode([node], channelId)
            : node.type !== "spoiler" && Array.isArray(node.content) ? { ...node, content: spoilerEmojis(node.content, channelId) }
                : node
    );
}

function spoilerContent(ast: ASTNode[], message: Message): ASTNode[] {
    const { text, emojis } = settings.store.conceal;
    if ((!text && !emojis) || !ast.length) return ast;

    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel || !shouldConcealMessageMedia(channel)) return ast;

    if (!text) return spoilerEmojis(ast, channel.id);
    return ast.length === 1 && ast[0].type === "spoiler" ? ast : [spoilerNode(ast, channel.id)];
}

const StickerSpoiler = ErrorBoundary.wrap(({ stickers }: { stickers: ReactNode; }) => (
    <Spoiler type="attachment" inline={false}>{() => stickers}</Spoiler>
), { noop: true });

function onStoreChange() {
    updateDiscordStreamerMode();
    MessageStore.emitChange();
}

function updateWatchers() {
    if (settings.store.detectPipewireWatcher) {
        if (!stopPipewire) {
            stopPipewire = startPipewireWatcher(
                () => settings.store.pipewireWatcherUrl,
                streaming => {
                    if (isPipewireStreaming !== streaming) {
                        isPipewireStreaming = streaming;
                        onStoreChange();
                    }
                }
            );
        }
    } else {
        stopPipewire?.();
        stopPipewire = null;
        if (isPipewireStreaming) {
            isPipewireStreaming = false;
            onStoreChange();
        }
    }

    if (settings.store.detectObs) {
        if (!stopObs) {
            stopObs = startObsWatcher({
                getAddress: () => settings.store.obsAddress,
                getPassword: () => settings.store.obsPassword,
                includeRecording: () => settings.store.obsIncludeRecording,
                includeVirtualCam: () => settings.store.obsIncludeVirtualCam,
            }, active => {
                if (isObsStreaming !== active) {
                    isObsStreaming = active;
                    onStoreChange();
                }
            });
        }
    } else {
        stopObs?.();
        stopObs = null;
        if (isObsStreaming) {
            isObsStreaming = false;
            onStoreChange();
        }
    }

    updateDiscordStreamerMode();
}

export default definePlugin({
    name: pluginInfo.name,
    description: pluginInfo.description,
    authors: pluginInfo.authors,
    settings,

    start() {
        StreamerModeStore.addChangeListener(onStoreChange);
        ApplicationStreamingStore.addChangeListener(onStoreChange);
        registerWatchersCallback(updateWatchers);
        updateWatchers();
    },

    stop() {
        StreamerModeStore.removeChangeListener(onStoreChange);
        ApplicationStreamingStore.removeChangeListener(onStoreChange);
        registerWatchersCallback(null);
        stopPipewire?.();
        stopPipewire = null;
        stopObs?.();
        stopObs = null;

        if (wasStreamerModeEnabledByPlugin) {
            wasStreamerModeEnabledByPlugin = false;
            if (StreamerModeStore.enabled) {
                FluxDispatcher.dispatch({
                    type: "STREAMER_MODE_UPDATE",
                    key: "enabled",
                    value: false,
                });
            }
        }

        isPipewireStreaming = false;
        isObsStreaming = false;
    },

    patches: [{
        // These checks run at Discord's message renderer boundary: no DOM observers, polling,
        // cache mutation, or attachment-copy allocation for messages that do not match.
        find: "this.renderAttachments(",
        replacement: [
            {
                match: /(?<=renderAttachments\((\i)\)\{)/,
                replace: "$1=$self.withSpoilerAttachments($1,this.props.channel);"
            },
            {
                match: /(?<=renderStickersAccessories\((\i)\)\{)/,
                replace: "if(!arguments[1]&&$self.shouldSpoilerStickers($1,this.props.channel))return $self.renderStickerSpoiler(this.renderStickersAccessories($1,!0));"
            }
        ]
    }, {
        find: "!1,hideSimpleEmbedContent",
        replacement: {
            match: /(?<=let (\i)=\i;)(?=return null!=\i&&\(\1=\i\(\1,\i\)\),\1\})/,
            replace: "$1=$self.spoilerContent($1,arguments[1]);"
        }
    }, {
        // Discord's own embed obscure-reason helper. Returning SPOILER here makes Discord render
        // its native blurred embed spoiler, exactly as for a link inside ||spoiler|| text.
        find: "author.bot&&",
        replacement: {
            match: /(?<=\.Embed,media:\i\},\i\);return .{0,80}?:)(\i)(?=\?\i\.\i\.SPOILER:null)/,
            replace: "($1||$self.shouldSpoilerEmbed(arguments[0],arguments[1]))"
        }
    }],

    renderStickerSpoiler(stickers: ReactNode) {
        return stickers == null ? null : <StickerSpoiler stickers={stickers} />;
    },

    withSpoilerAttachments,
    shouldSpoilerEmbed,
    shouldSpoilerStickers,
    spoilerContent,
});
