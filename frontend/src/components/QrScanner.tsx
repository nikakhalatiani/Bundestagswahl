import { useEffect, useRef } from 'react';
import QrScannerLib from 'qr-scanner';
import { cn } from '../utils/cn';

QrScannerLib.WORKER_PATH = new URL(
  'qr-scanner/qr-scanner-worker.min.js',
  import.meta.url
).toString();

interface QrScannerProps {
  onScanSuccess?: (result: string) => void;
  onScanError?: (error: string) => void;
  onCameraLoaded?: () => void;
  className?: string;
  hintSrc?: string;
  showHint?: boolean;
}

export function QrScanner({
  onScanSuccess,
  onScanError,
  onCameraLoaded,
  className,
  hintSrc,
  showHint = false,
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerLib | null>(null);
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const initScanner = async () => {
      if (!videoRef.current || !mounted) return;

      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!mounted) return;

        scannerRef.current = new QrScannerLib(
          videoRef.current,
          (result) => {
            const text = result.data ?? '';
            if (text && text !== lastRef.current) {
              lastRef.current = text;
              onScanSuccess?.(text);
            }
          },
          {
            returnDetailedScanResult: true,
            highlightScanRegion: false,
            highlightCodeOutline: true,
            preferredCamera: 'environment',
            calculateScanRegion: (video) => ({
              x: 0,
              y: 0,
              width: video.videoWidth,
              height: video.videoHeight,
              downScaledWidth: 500,
              downScaledHeight: 500,
            }),
          }
        );

        await scannerRef.current.start();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError' && mounted) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (!mounted) return;
          try {
            await scannerRef.current?.start();
          } catch (retryErr) {
            const error = `Error initializing scanner: ${retryErr}`;
            onScanError?.(error);
          }
        } else {
          const error = `Error initializing scanner: ${err}`;
          onScanError?.(error);
        }
      }
    };

    initScanner();

    return () => {
      mounted = false;
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, [onScanSuccess, onScanError, onCameraLoaded]);

  return (
    <div
      className={cn(
        'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[14px] border border-line bg-black',
        className
      )}
    >
      <video
        ref={videoRef}
        onLoadedMetadata={() => onCameraLoaded?.()}
        className="h-full w-full object-cover"
      />
      {showHint && hintSrc && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <img src={hintSrc} alt="" className="h-2/3 w-2/3 opacity-20" />
        </div>
      )}
    </div>
  );
}
