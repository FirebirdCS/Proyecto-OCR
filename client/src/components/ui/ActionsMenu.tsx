import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export interface ActionsMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ActionsMenuProps {
  items: ActionsMenuItem[];
  label: string;
  disabled?: boolean;
}

/** Breathing room between the trigger and the panel, and from the viewport edge. */
const GAP = 6;

interface Position {
  top: number;
  left: number;
}

export function ActionsMenu({ items, label, disabled }: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * The panel is fixed to the viewport, so its place has to be measured rather
   * than inherited. Right-aligned with the trigger, flipped above it when the
   * row sits near the bottom of the window, and always kept on screen.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const rect = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = panel;

    const below = rect.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - GAP;
    const top = fitsBelow ? below : Math.max(GAP, rect.top - GAP - height);
    const left = Math.max(GAP, Math.min(rect.right - width, window.innerWidth - width - GAP));

    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      // The panel is no longer a descendant of the trigger, so both are checked.
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', place);
    // Capture, because the trigger sits inside a scrolling table whose own
    // scroll events never reach the window.
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <div className="actions-menu">
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled}
      >
        <MoreVertical size={18} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="actions-menu-panel"
            role="menu"
            // Hidden for the first paint only: the panel has to be in the DOM
            // before it can be measured, and an unplaced one would flash at 0,0.
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`menu-item${item.danger ? ' menu-item--danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
