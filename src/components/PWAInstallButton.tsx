import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  fullWidth?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ fullWidth = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] px-4 py-2 text-xs font-semibold text-[#5C3D2E] hover:bg-[#EDE3D8] transition-colors whitespace-nowrap shrink-0 ${
          fullWidth ? 'w-full' : ''
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install REXON App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] px-4 py-2 text-xs font-semibold text-[#5C3D2E] hover:bg-[#EDE3D8] transition-colors whitespace-nowrap shrink-0 ${
            fullWidth ? 'w-full' : ''
          }`}
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>Add to Home Screen</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-sm rounded-xl bg-white border border-[#E5DDD2] p-6 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-base font-semibold text-[#1F1916]">
                  Install on iPhone or iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                  aria-label="Close installation guide"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2 text-sm text-[#574B43] list-decimal list-inside">
                <li>Tap the Share icon in the Safari toolbar.</li>
                <li>Scroll down and tap Add to Home Screen.</li>
                <li>Tap Add to launch REXON HR in standalone mode.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-lg bg-[#5C3D2E] py-2 text-sm font-medium text-white hover:bg-[#4A3023] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
