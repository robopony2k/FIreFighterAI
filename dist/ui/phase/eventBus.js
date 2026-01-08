export class EventBus {
    constructor() {
        this.listeners = {};
    }
    on(event, listener) {
        if (!this.listeners[event]) {
            this.listeners[event] = new Set();
        }
        this.listeners[event]?.add(listener);
    }
    off(event, listener) {
        this.listeners[event]?.delete(listener);
    }
    emit(event, payload) {
        const handlers = this.listeners[event];
        if (!handlers) {
            return;
        }
        handlers.forEach((listener) => listener(payload));
    }
}
