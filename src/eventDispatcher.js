class EventDispatcher {
  constructor() {
    this.listeners = new Map();
  }

  on(eventType, callback) {
    if (!this.listeners.has(eventType)) this.listeners.set(eventType, []);
    this.listeners.get(eventType).push(callback);
    return () => this.off(eventType, callback);
  }

  off(eventType, callback) {
    const arr = this.listeners.get(eventType);
    if (!arr) return;
    const idx = arr.indexOf(callback);
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) this.listeners.delete(eventType);
  }

  emit(eventType, payload = {}) {
    const arr = this.listeners.get(eventType) || [];
    for (const cb of arr.slice()) {
      try {
        cb(payload);
      } catch (err) {
        // swallow listener errors to avoid breaking the loop
        console.error('Event listener error for', eventType, err);
      }
    }
  }
}

export default EventDispatcher;
