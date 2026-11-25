/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const MAX_TIMEOUT = 2 ** 31 - 1;

/** Delays that double after every failure with no upper limit, and start over once a connection works. */
export function createBackoff(min = 1000) {
    let delay = min;
    return {
        next() {
            const current = Math.min(delay, MAX_TIMEOUT);
            delay *= 2;
            return current;
        },
        reset() {
            delay = min;
        }
    };
}

/** How long a lost connection keeps the last "active" state before it counts as inactive. */
export const DISCONNECT_GRACE_MS = 15_000;

/** What a watcher hands back: stop it, re-evaluate its options, or retry a pending reconnect right away. */
export interface Watcher {
    stop(): void;
    refresh?(): void;
    retryNow(): void;
}
