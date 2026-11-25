/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { createBackoff, DISCONNECT_GRACE_MS, Watcher } from "./backoff";
import { PATTERNS } from "./patterns";

const logger = new Logger("DmMediaSpoiler");
const { op: OP, outputs: OUTPUTS } = PATTERNS.obs;

type Output = keyof typeof OUTPUTS;

export interface ObsWatcherOptions {
    getAddress: () => string;
    getPassword: () => string;
    includeRecording: () => boolean;
    includeVirtualCam: () => boolean;
}

interface ObsMessage {
    op: number;
    d: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function parseMessage(data: unknown): ObsMessage | null {
    if (typeof data !== "string") return null;
    try {
        const message: unknown = JSON.parse(data);
        if (isRecord(message) && typeof message.op === "number" && isRecord(message.d)) return { op: message.op, d: message.d };
    } catch (err) {
        logger.debug("Ignoring a malformed OBS message", err);
    }
    return null;
}

async function computeObsAuth(password: string, salt: string, challenge: string): Promise<string> {
    const encoder = new TextEncoder();
    const passSaltHash = await crypto.subtle.digest("SHA-256", encoder.encode(password + salt));
    const secretHashBase64 = btoa(String.fromCharCode(...new Uint8Array(passSaltHash)));
    const authHash = await crypto.subtle.digest("SHA-256", encoder.encode(secretHashBase64 + challenge));
    return btoa(String.fromCharCode(...new Uint8Array(authHash)));
}

export function startObsWatcher(options: ObsWatcherOptions, onStateChange: (active: boolean) => void): Watcher {
    let running = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const backoff = createBackoff();
    const state: Record<Output, boolean> = { stream: false, record: false, virtualCam: false };
    let lastActive: boolean | null = null;

    function evaluateActive() {
        const active = state.stream
            || (options.includeRecording() && state.record)
            || (options.includeVirtualCam() && state.virtualCam);
        if (active === lastActive) return;
        lastActive = active;
        onStateChange(active);
    }

    function resetState() {
        state.stream = state.record = state.virtualCam = false;
        evaluateActive();
    }

    function clearGrace() {
        if (graceTimer != null) clearTimeout(graceTimer);
        graceTimer = null;
    }

    function connectionLost() {
        ws = null;
        if (lastActive && graceTimer == null) graceTimer = setTimeout(() => {
            graceTimer = null;
            resetState();
        }, DISCONNECT_GRACE_MS);
        else if (!lastActive) resetState();
        scheduleReconnect();
    }

    function scheduleReconnect() {
        if (!running || reconnectTimer != null) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, backoff.next());
    }

    function setOutput(output: Output, data: unknown) {
        if (!isRecord(data)) return;
        state[output] = Boolean(data.outputActive);
        evaluateActive();
    }

    async function onMessage(socket: WebSocket, message: ObsMessage) {
        const { op, d } = message;
        const send = (sendOp: number, payload: Record<string, unknown>) => {
            if (ws === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: sendOp, d: payload }));
        };

        if (op === OP.hello) {
            const auth = d.authentication;
            const password = options.getPassword();
            const authentication = isRecord(auth) && password && typeof auth.salt === "string" && typeof auth.challenge === "string"
                ? await computeObsAuth(password, auth.salt, auth.challenge)
                : undefined;
            send(OP.identify, { rpcVersion: PATTERNS.obs.rpcVersion, authentication, eventSubscriptions: PATTERNS.obs.eventSubscriptions });
        } else if (op === OP.identified) {
            backoff.reset();
            for (const { request, id } of Object.values(OUTPUTS)) send(OP.request, { requestType: request, requestId: id });
        } else if (op === OP.requestResponse) {
            const output = (Object.keys(OUTPUTS) as Output[]).find(key => OUTPUTS[key].id === d.requestId);
            if (output) {
                clearGrace();
                setOutput(output, d.responseData);
            }
        } else if (op === OP.event) {
            const output = (Object.keys(OUTPUTS) as Output[]).find(key => OUTPUTS[key].event === d.eventType);
            if (output) setOutput(output, d.eventData);
        }
    }

    function connect() {
        if (!running) return;
        const address = options.getAddress().trim() || PATTERNS.obs.defaultAddress;
        let socket: WebSocket;
        try {
            socket = new WebSocket(address);
        } catch (err) {
            logger.warn("Can't connect to OBS at", address, err);
            connectionLost();
            return;
        }
        ws = socket;

        socket.onmessage = event => {
            if (ws !== socket) return;
            const message = parseMessage(event.data);
            if (message) onMessage(socket, message).catch(err => logger.warn("Handling an OBS message failed", err));
        };
        socket.onclose = () => {
            if (ws === socket) connectionLost();
        };
        socket.onerror = () => {
            if (ws !== socket) return;
            socket.close();
            connectionLost();
        };
    }

    connect();

    return {
        stop() {
            running = false;
            if (reconnectTimer != null) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            clearGrace();
            const socket = ws;
            ws = null;
            socket?.close();
            resetState();
        },
        refresh: evaluateActive,
        retryNow() {
            if (!running || reconnectTimer == null) return;
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
            connect();
        }
    };
}
