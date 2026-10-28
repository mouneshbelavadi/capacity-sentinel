import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock WebSocket in jsdom test environment if not present
if (typeof window !== 'undefined' && typeof window.WebSocket === 'undefined') {
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 1;
    url = '';

    send = vi.fn();
    close = vi.fn();

    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      setTimeout(() => {
        if (this.onopen) {
          this.onopen(new Event('open'));
        }
      }, 0);
    }
  }

  // @ts-expect-error test mock
  window.WebSocket = MockWebSocket;
  // @ts-expect-error test mock
  global.WebSocket = MockWebSocket;
}

// Mock ResizeObserver for @react-three/fiber (react-use-measure)
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  // @ts-expect-error test mock
  window.ResizeObserver = MockResizeObserver;
  // @ts-expect-error test mock
  global.ResizeObserver = MockResizeObserver;
}
