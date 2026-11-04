import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, RefreshCw, ShieldCheck, SwitchCamera, Upload, X } from 'lucide-react';

export interface CapturedAttendancePhoto {
  file: File;
  previewDataUrl: string;
  cameraFacing: 'user' | 'environment';
  capturedAt: string;
}

interface CameraCaptureModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  defaultFacing?: 'user' | 'environment';
  onClose: () => void;
  onCapture: (captured: CapturedAttendancePhoto) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  title,
  subtitle,
  defaultFacing = 'user',
  onClose,
  onCapture,
}) => {
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(defaultFacing);
  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturedPreview, setCapturedPreview] = useState<string>('');
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedTimestamp, setCapturedTimestamp] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
  }, []);

  const startCameraStream = useCallback(
    async (targetFacing: 'user' | 'environment') => {
      stopCameraStream();
      setCameraError('');

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraError(
          'Live browser camera preview is unavailable on this device/context. Use the direct Camera / Photo button below.'
        );
        return;
      }

      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: targetFacing },
            width: { ideal: 960 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStreamActive(true);
      } catch (err) {
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Camera permission was denied in browser settings. Allow camera access or capture via the device camera picker below.'
            : 'Unable to start live camera feed. Use the device camera button below to capture your photo.';
        setCameraError(msg);
        setStreamActive(false);
      }
    },
    [stopCameraStream]
  );

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      setCapturedPreview('');
      setCapturedFile(null);
      setCameraError('');
      return;
    }
    setFacingMode(defaultFacing);
    void startCameraStream(defaultFacing);
    return () => {
      stopCameraStream();
    };
  }, [isOpen, defaultFacing, startCameraStream, stopCameraStream]);

  const handleSwitchCamera = () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    setCapturedPreview('');
    setCapturedFile(null);
    void startCameraStream(nextFacing);
  };

  const handleShutterCapture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera frame is still initializing. Wait a moment or use device capture.');
      return;
    }

    const maxDim = 720;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);

    const nowIso = new Date().toISOString();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `attendance_${facingMode}_${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        setCapturedPreview(dataUrl);
        setCapturedFile(file);
        setCapturedTimestamp(nowIso);
        stopCameraStream();
      },
      'image/jpeg',
      0.78
    );
  };

  const handleNativeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setCameraError('Select a valid JPG, PNG, or WEBP photograph.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setCameraError('Photograph exceeds the 15 MB size limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCapturedPreview(reader.result);
        setCapturedFile(file);
        setCapturedTimestamp(new Date().toISOString());
        stopCameraStream();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRetake = () => {
    setCapturedPreview('');
    setCapturedFile(null);
    setCapturedTimestamp('');
    void startCameraStream(facingMode);
  };

  const handleConfirm = () => {
    if (!capturedFile || !capturedPreview) return;
    onCapture({
      file: capturedFile,
      previewDataUrl: capturedPreview,
      cameraFacing: facingMode,
      capturedAt: capturedTimestamp || new Date().toISOString(),
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[#FAF8F5] border border-[#E6DFD5] rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E6DFD5] flex items-center justify-between bg-white">
          <div>
            <h3 className="text-base font-bold text-[#211813]">{title}</h3>
            {subtitle && <p className="text-xs text-[#6F5E53] mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#6F5E53] hover:text-[#211813] hover:bg-[#F3EDE4] transition-colors"
            aria-label="Close camera modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Camera Mode Selector */}
          <div className="flex items-center justify-between gap-2 bg-[#F3EDE4] p-1.5 rounded-xl border border-[#E6DFD5]">
            <button
              type="button"
              onClick={() => {
                if (facingMode !== 'user') handleSwitchCamera();
              }}
              className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                facingMode === 'user'
                  ? 'bg-[#5C3D2E] text-white shadow-xs'
                  : 'text-[#6F5E53] hover:text-[#211813]'
              }`}
            >
              Front Camera (Selfie)
            </button>
            <button
              type="button"
              onClick={() => {
                if (facingMode !== 'environment') handleSwitchCamera();
              }}
              className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                facingMode === 'environment'
                  ? 'bg-[#5C3D2E] text-white shadow-xs'
                  : 'text-[#6F5E53] hover:text-[#211813]'
              }`}
            >
              Rear Camera (Site View)
            </button>
            <button
              type="button"
              onClick={handleSwitchCamera}
              title="Flip Camera"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-white border border-[#E6DFD5] text-[#5C3D2E] hover:bg-[#FAF8F5]"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>
          </div>

          {/* Preview Frame */}
          <div className="relative aspect-4/3 w-full rounded-xl overflow-hidden bg-[#211813] border border-[#D4C7B8] flex items-center justify-center">
            {capturedPreview ? (
              <img
                src={capturedPreview}
                alt="Captured attendance verification"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${
                  facingMode === 'user' ? '-scale-x-100' : ''
                } ${streamActive ? 'opacity-100' : 'opacity-20'}`}
              />
            )}

            {!capturedPreview && !streamActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-[#FAF8F5]">
                <Camera className="w-8 h-8 text-[#D4C7B8] mb-2" />
                <p className="text-xs text-[#E6DFD5] max-w-xs">
                  {cameraError || 'Initializing camera preview...'}
                </p>
              </div>
            )}
          </div>

          {/* Explicit Privacy & Non-Biometric Disclosure */}
          <div className="p-3 rounded-lg bg-white border border-[#E6DFD5] flex items-start gap-2.5 text-[11px] text-[#6F5E53]">
            <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
            <span>
              Privacy Notice: Photograph is captured strictly for duty attendance / site presence
              verification and stored privately. Automated facial recognition or biometric profiling
              is never performed.
            </span>
          </div>

          {/* Hidden Native Mobile Camera Picker Fallback */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture={facingMode}
            onChange={handleNativeFileChange}
            className="hidden"
          />

          {/* Primary Controls (>= 48px touch targets) */}
          {capturedPreview ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleRetake}
                className="min-h-[48px] px-4 py-2.5 rounded-xl border border-[#D4C7B8] bg-white text-sm font-semibold text-[#211813] hover:bg-[#F3EDE4] flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retake Photo
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#166534] text-sm font-semibold text-white hover:bg-[#14532D] flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Use This Photo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {streamActive && (
                <button
                  type="button"
                  onClick={handleShutterCapture}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3124] flex items-center justify-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  Capture Photo
                </button>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`min-h-[48px] px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${
                  streamActive
                    ? 'border border-[#D4C7B8] bg-white text-[#211813] hover:bg-[#F3EDE4]'
                    : 'sm:col-span-2 bg-[#5C3D2E] text-white hover:bg-[#4A3124]'
                }`}
              >
                <Upload className="w-4 h-4" />
                {streamActive ? 'Device Camera / File' : 'Open Device Camera / Select Photo'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
