import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A named action with the same preview available to pointer and keyboard users. */
export function PreviewButton({
  children,
  preview,
  onClick,
  className = '',
  label,
}: {
  children: ReactNode;
  preview: ReactNode;
  onClick: () => void;
  className?: string;
  label: string;
}) {
  const id = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  function reveal(element: HTMLButtonElement) {
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 292)),
      top: Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 170)),
    });
  }

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-describedby={position ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') reveal(e.currentTarget);
        }}
        onPointerLeave={() => setPosition(null)}
        onFocus={(e) => reveal(e.currentTarget)}
        onBlur={() => setPosition(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setPosition(null);
        }}
        onClick={() => {
          setPosition(null);
          onClick();
        }}
      >
        {children}
      </button>

      {position &&
        createPortal(
          <div id={id} role="tooltip" className="entity-preview" style={position}>
            {preview}
            <span className="preview-hint">Click or press Enter to open details</span>
          </div>,
          document.body
        )}
    </>
  );
}
