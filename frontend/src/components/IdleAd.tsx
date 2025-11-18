import { useState, useEffect, useRef } from 'react';
import { loadDetector, runDetection } from '../detectors/DetectorManager';
import { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import clsx from 'clsx';

interface IdleAdProps {
  /**
   * Path to the ad video inside public folder.
   * Default: /ads/AD.mp4
   */
  videoSrc?: string;

  /**
   * Time in milliseconds before showing ad when no person is detected
   * @default 30000 (30 seconds)
   */
  inactivityTimeout?: number;

  /**
   * CSS transition duration for overlay fade in/out
   * @default "500ms"
   */
  transitionDuration?: string;
}

// Video file should be at: public/ads/AD.mp4
const DEFAULT_AD_VIDEO_SRC = '/ads/AD.mp4';

export function IdleAd({
  videoSrc = DEFAULT_AD_VIDEO_SRC,
  inactivityTimeout = 30000,
  transitionDuration = '500ms',
}: IdleAdProps) {
  const [isAdVisible, setIsAdVisible] = useState(false);
  const [isDetectorReady, setIsDetectorReady] = useState(false);
  const [cameraError, setCameraError] = useState<string>('');
  const [isMuted, setIsMuted] = useState(true); // 🔊 audio state (start muted so autoplay works)

  // Hidden camera stream video (for detection)
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  // Fullscreen ad video
  const adVideoRef = useRef<HTMLVideoElement>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const detectionRef = useRef<number>(0);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // Initialize face detection + camera
  useEffect(() => {
    console.log('[IdleAd] Initializing face detector...');
    loadDetector('face')
      .then(() => {
        if (!mountedRef.current) return;
        console.log('[IdleAd] Detector loaded successfully');
        setIsDetectorReady(true);
        initCamera();
      })
      .catch((error: any) => {
        if (!mountedRef.current) return;
        console.error('[IdleAd] Failed to initialize face detector:', error);
        setCameraError(`Failed to load face detection: ${error.message ?? String(error)}`);
      });

    return () => {
      mountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play / pause ad video based on visibility
  useEffect(() => {
    const adVideo = adVideoRef.current;
    if (!adVideo) return;

    if (isAdVisible) {
      console.log('[IdleAd] Showing idle ad video overlay');
      // Hide cursor
      document.body.style.cursor = 'none';

      const playPromise = adVideo.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.catch((err) => {
          console.warn('[IdleAd] Autoplay blocked or failed:', err);
        });
      }
    } else {
      console.log('[IdleAd] Hiding idle ad video overlay');
      document.body.style.cursor = '';
      adVideo.pause();
      adVideo.currentTime = 0;
      // When hiding ad, go back to muted for next cycle
      setIsMuted(true);
    }

    return () => {
      document.body.style.cursor = '';
    };
  }, [isAdVisible]);

  // Initialize camera
  const initCamera = async () => {
    try {
      console.log('[IdleAd] Requesting camera access for detection...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();

        console.log(
          '[IdleAd] Stream Resolution:',
          cameraVideoRef.current.videoWidth,
          'x',
          cameraVideoRef.current.videoHeight
        );

        if (cameraVideoRef.current.readyState >= 2) {
          startDetection();
        } else {
          cameraVideoRef.current.onloadeddata = () => startDetection();
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('[IdleAd] Camera initialization failed:', err);
      setCameraError(err instanceof Error ? err.message : 'Failed to access camera');
    }
  };

  // Start person detection loop
  const startDetection = () => {
    if (!cameraVideoRef.current) return;

    console.log('[IdleAd] Starting face detection loop...');

    const detectPerson = async () => {
      if (!cameraVideoRef.current || !mountedRef.current) return;

      try {
        const results = runDetection(
          'face',
          cameraVideoRef.current
        ) as FaceLandmarkerResult | undefined;

        const facesDetected = !!results?.faceLandmarks?.length;

        if (facesDetected) {
          // Person detected — hide ad and reset timer
          if (isAdVisible) {
            console.log('[IdleAd] Face detected — hiding ad overlay');
          }
          setIsAdVisible(false);
          document.body.style.cursor = '';

          if (inactivityTimerRef.current) {
            clearTimeout(inactivityTimerRef.current);
            inactivityTimerRef.current = null;
          }
        } else {
          // No person detected — start inactivity timer if not active
          if (!inactivityTimerRef.current && !isAdVisible) {
            console.log(
              `[IdleAd] No face detected — starting inactivity timer (${inactivityTimeout} ms)`
            );
            inactivityTimerRef.current = setTimeout(() => {
              if (mountedRef.current) {
                console.log('[IdleAd] Inactivity timeout reached — showing ad overlay');
                setIsAdVisible(true);
              }
            }, inactivityTimeout);
          }
        }
      } catch (error) {
        console.error('[IdleAd] Error in detection loop:', error);
      }

      if (mountedRef.current) {
        detectionRef.current = requestAnimationFrame(detectPerson);
      }
    };

    detectPerson();
  };

  // Cleanup resources
  const cleanup = () => {
    console.log('[IdleAd] Cleaning up resources...');
    if (detectionRef.current) {
      cancelAnimationFrame(detectionRef.current);
    }

    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }

    document.body.style.cursor = '';
  };

  // User click to enable sound
  const handleUnmuteClick = () => {
    const video = adVideoRef.current;
    if (!video) return;

    setIsMuted(false);
    // call play() again in case browser paused it when we toggled audio
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch((err) => {
        console.warn('[IdleAd] Play after unmute failed:', err);
      });
    }
  };

  // If camera fails, still show the ad video fullscreen as fallback
  if (cameraError) {
    return (
      <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center z-[9999]">
        <div className="text-center max-w-md mx-auto p-6">
          <h3 className="text-white text-xl font-semibold mb-2">Camera Access Error</h3>
          <p className="text-white/80 mb-4">{cameraError}</p>
        </div>
        <div className="relative w-full h-full">
          <video
            ref={adVideoRef}
            className="w-full h-full object-contain bg-black"
            autoPlay
            loop
            playsInline
            muted={isMuted}
            defaultMuted
            onError={(e) => {
              const el = e.currentTarget;
              console.error(
                '[IdleAd] Ad video error (fallback mode). readyState:',
                el.readyState,
                'networkState:',
                el.networkState
              );
            }}
          >
            <source src={videoSrc} type="video/mp4" />
          </video>

          {/* Unmute button in fallback mode */}
          {isMuted && (
            <button
              type="button"
              onClick={handleUnmuteClick}
              className="absolute bottom-6 right-6 bg-white/80 text-black px-4 py-2 rounded-full shadow-lg text-sm font-semibold hover:bg-white"
            >
              Tap to enable sound 🔊
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Hidden video element for detection */}
      <video ref={cameraVideoRef} className="hidden" playsInline muted />

      {/* Advertisement Overlay */}
      <div
        className={clsx(
          'fixed inset-0 bg-black z-[9999]',
          'transition-all ease-in-out',
          isAdVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'
        )}
        style={{
          transitionDuration,
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <video
          ref={adVideoRef}
          className="absolute inset-0 w-full h-full object-contain bg-black"
          loop
          playsInline
          muted={isMuted}   // 🔊 controlled mute
          defaultMuted      // important for first autoplay
          onError={(e) => {
            const el = e.currentTarget;
            console.error(
              '[IdleAd] Ad video error. readyState:',
              el.readyState,
              'networkState:',
              el.networkState
            );
          }}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>

        {/* Unmute button */}
        {isMuted && isAdVisible && (
          <button
            type="button"
            onClick={handleUnmuteClick}
            className="absolute bottom-6 right-6 bg-white/80 text-black px-4 py-2 rounded-full shadow-lg text-sm font-semibold hover:bg-white"
          >
            Tap to enable sound 🔊
          </button>
        )}

        {/* Debug info */}
        <div className="absolute top-4 right-4 bg-black/50 text-white text-sm p-2 rounded">
          Idle Ad Video • Detector: {isDetectorReady ? 'Ready' : 'Loading'} • Sound:{' '}
          {isMuted ? 'Muted' : 'On'}
        </div>
      </div>
    </>
  );
}
