// src/renderer/services/NotificationService.ts

const CONTAINER_ID = 'notification-container';

export type NotificationType = 'success' | 'error';

export type NotificationHandler = (message: string, type: NotificationType) => void;

class NotificationServiceController {
    private container: HTMLElement | null = null;
    private handler: NotificationHandler | null = null;

    /**
     * Optionally pins the container to use. If not called, the service
     * adopts an existing `#notification-container` or creates one in
     * `document.body` on first use — it never blocks on a native alert.
     */
    public init(containerElement: HTMLElement): void {
        this.container = containerElement;
    }

    /**
     * Routes notifications to a custom renderer (e.g. the compact
     * launcher's in-flow banner) and suppresses DOM toasts while set.
     */
    public setHandler(handler: NotificationHandler | null): void {
        this.handler = handler;
    }

    public showSuccess(message: string): void {
        this.showToast(message, 'success');
    }

    public showError(message: string): void {
        this.showToast(message, 'error');
    }

    private ensureContainer(): HTMLElement {
        if (this.container?.isConnected) {
            return this.container;
        }
        const existing = document.getElementById(CONTAINER_ID);
        if (existing) {
            this.container = existing;
            return existing;
        }
        const created = document.createElement('div');
        created.id = CONTAINER_ID;
        created.className = 'notification-container';
        document.body.appendChild(created);
        this.container = created;
        return created;
    }

    private showToast(message: string, type: NotificationType): void {
        if (this.handler) {
            this.handler(message, type);
            return;
        }
        const container = this.ensureContainer();

        const toast = document.createElement('div');
        toast.className = `toast-notification ${type}`;

        const icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.textContent = type === 'success' ? '✅' : '❌';

        const text = document.createElement('span');
        text.textContent = message;

        toast.append(icon, text);
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }
}

export const NotificationService = new NotificationServiceController();
