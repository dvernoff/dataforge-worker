/**
 * Feature WebSocket Plugin
 *
 * Provides real-time WebSocket connections for live data updates.
 * Clients connect to ws://worker/ws/v1/{projectSlug} and subscribe
 * to channels like "table:users" to receive INSERT/UPDATE/DELETE events.
 */

export { WebSocketService, websocketRoutes } from '../../../realtime/websocket.service.js';
