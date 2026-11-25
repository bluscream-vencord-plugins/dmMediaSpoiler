/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The longest delay setTimeout accepts; anything longer fires immediately instead. */
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Reconnect delays that double after every failure, starting at `min` with no upper limit, and start over once a
 * connection works. Keeps a service that isn't running (OBS closed, no PipeWire helper) from being retried every few
 * seconds forever.
 */
export function createBackoff(min = 1000) {
    let delay = min;
    return {
        /** The delay before the next attempt; each call doubles the one after it. */
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
