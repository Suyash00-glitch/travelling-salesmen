import { useState, useEffect, useRef } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { ScanLine, Camera, Search } from 'lucide-react';
import { Modal } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';

interface ScanDialogProps {
  onClose: () => void;
  onScan: (code: string) => void;
}

export function ScanDialog({ onClose, onScan }: ScanDialogProps) {
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState('');

  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | undefined>(undefined);
  const resolved = useRef(false);
  const callback = useRef(onScan);
  callback.current = onScan;

  function clean(value: string) {
    try {
      const url = new URL(value);
      return decodeURIComponent(url.pathname.split('/').pop() ?? value);
    } catch {
      return value.trim();
    }
  }

  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    const reader = new BrowserQRCodeReader();

    void reader
      .decodeFromVideoDevice(undefined, video.current!, (result) => {
        if (result && !resolved.current) {
          resolved.current = true;
          controls.current?.stop();
          callback.current(clean(result.getText()));
        }
      })
      .then((c) => {
        controls.current = c;
        if (cancelled) c.stop();
      })
      .catch((e) => {
        setError(`Camera unavailable: ${(e as Error).message}. Enter the printed roll code below.`);
        setCamera(false);
      });

    return () => {
      cancelled = true;
      controls.current?.stop();
    };
  }, [camera]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Scan a roll label"
      description="Point your camera at the QR label, or enter the printed roll ID."
    >
      <div className="scanner-frame">
        {camera ? (
          <video ref={video} muted playsInline />
        ) : (
          <>
            <ScanLine size={54} />
            <p>Every roll, instantly traceable.</p>
            <Button variant="outline" onClick={() => setCamera(true)}>
              <Camera size={16} />
              Enable camera
            </Button>
          </>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          controls.current?.stop();
          onScan(clean(code));
        }}
      >
        <label className="field">
          <span>Roll code or passport URL</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="RL-3010"
          />
        </label>
        <div className="dialog-footer">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button>
            <Search size={15} />
            Find roll
          </Button>
        </div>
      </form>
    </Modal>
  );
}
