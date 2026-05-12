import { randomUUID } from 'crypto';
import { Event, EventType } from '../models/types';

type Handler = (event: Event) => void;

/**
 * In-memory event bus. In production this would publish to Kafka/SNS.
 * Events are immutable once emitted — stored append-only.
 */
class EventBus {
  private handlers: Map<EventType, Handler[]> = new Map();
  private log: Event[] = [];

  emit(type: EventType, payload: any): Event {
    const event: Event = {
      eventId: randomUUID(),
      type,
      timestamp: Date.now(),
      payload
    };
    this.log.push(Object.freeze(event));

    const handlers = this.handlers.get(type) ?? [];
    for (const h of handlers) {
      try { h(event); } catch { /* handler errors must not affect emitter */ }
    }
    return event;
  }

  on(type: EventType, handler: Handler): void {
    const existing = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...existing, handler]);
  }

  getLog(): readonly Event[] {
    return this.log;
  }

  // For testing: drain log
  clearLog(): void {
    this.log = [];
  }
}

export const eventBus = new EventBus();
