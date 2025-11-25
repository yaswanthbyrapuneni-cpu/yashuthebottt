/**
 * SecurityMonitor Component
 * Monitors for motion and face detection during security hours (10 PM - 7 AM)
 * Sends alerts via Flask backend API (email + Twilio calls)
 * Triggers siren and stores events in Supabase
 */

import { useEffect, useRef, useState } from 'react';
import { SecurityDetector } from '../utils/motion-detection';
import {
  getSecuritySettings,
  isSecurityModeActive,
  captureImageFromVideo,
  storeSecurityEvent,
  uploadSecurityImage,
  updateSirenState,
  subscribeSirenStateChanges,
  updateLastDetectionTime
} from '../utils/supabase-security';


interface SecurityMonitorProps {
  isActive: boolean; // Controlled by parent (admin dashboard toggle)
  onSecurityStateChange?: (isMonitoring: boolean) => void; // Notify parent when monitoring starts/stops
}

export default function SecurityMonitor({ 
  isActive,
  onSecurityStateChange
}: SecurityMonitorProps) {
  const [securityModeEnabled, setSecurityModeEnabled] = useState(false);
  const [sirenActive, setSirenActive] = useState(false);
  const [lastMotionDetected, setLastMotionDetected] = useState(false);
  const [lastFaceDetected, setLastFaceDetected] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const detectorRef = useRef<SecurityDetector | null>(null);
  const monitoringIntervalRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  
  const motionStateRef = useRef({
    isDetected: false,
    alertSent: false
  });
  
  const faceStateRef = useRef({
    isDetected: false,
    alertSent: false
  });
  const lastMotionCallTimeRef = useRef<number>(0);
  const lastFaceCallTimeRef = useRef<number>(0);
  const CALL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between calls

  const kioskId = import.meta.env.VITE_KIOSK_ID || 'KIOSK_001';
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

  // Initialize
  useEffect(() => {
    console.log('[Security Monitor] Initializing...');
    console.log('[Security Monitor] Backend URL:', BACKEND_URL);
    
    mountedRef.current = true;
    detectorRef.current = new SecurityDetector();
    
    // Create hidden video element
    const video = document.createElement('video');
    video.style.display = 'none';
    video.playsInline = true;
    video.muted = true;
    document.body.appendChild(video);
    videoRef.current = video;
    
    // Load siren audio
    audioRef.current = new Audio('/siren.mp3');
    audioRef.current.loop = false;

    return () => {
      mountedRef.current = false;
      cleanup();
      if (videoRef.current) {
        document.body.removeChild(videoRef.current);
      }
    };
  }, []);

  // Check security mode periodically
  useEffect(() => {
    const checkSecurityMode = async () => {
      try {
        const settings = await getSecuritySettings(kioskId);
        
        if (!settings) {
          console.warn('[Security Monitor] No settings found for kiosk:', kioskId);
          return;
        }

        const shouldBeActive = isSecurityModeActive(settings) && isActive;
        
        if (shouldBeActive !== securityModeEnabled) {
          console.log('[Security Monitor] Security mode changed:', shouldBeActive);
          setSecurityModeEnabled(shouldBeActive);
          
          if (shouldBeActive) {
            await startMonitoring();
          } else {
            stopMonitoring();
          }
          
          // Notify parent
          if (onSecurityStateChange) {
            onSecurityStateChange(shouldBeActive);
          }
        }

      } catch (error) {
        console.error('[Security Monitor] Failed to check security settings:', error);
      }
    };

    checkSecurityMode();
    const checkInterval = setInterval(checkSecurityMode, 60000); // Check every minute

    return () => {
      clearInterval(checkInterval);
    };
  }, [kioskId, isActive, securityModeEnabled]);

  // Subscribe to siren state changes
  useEffect(() => {
    const channel = subscribeSirenStateChanges(kioskId, (sirenActiveState) => {
      console.log('[Security Monitor] Siren state updated:', sirenActiveState);
      setSirenActive(sirenActiveState);
      
      if (sirenActiveState) {
        playSiren();
      } else {
        stopSiren();
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [kioskId]);

  const initCamera = async () => {
    if (!mountedRef.current || !videoRef.current) return;
    
    try {
      console.log('[Security Monitor] Requesting camera access...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      
      await videoRef.current.play();

      console.log('[Security Monitor] Camera initialized successfully');
      setCameraError(null);
      
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('[Security Monitor] Camera initialization failed:', err);
      setCameraError(err instanceof Error ? err.message : 'Failed to access camera');
    }
  };

  const startMonitoring = async () => {
    if (monitoringIntervalRef.current) {
      console.log('[Security Monitor] Already monitoring');
      return;
    }

    console.log('[Security Monitor] Starting monitoring...');
    
    // Initialize camera first
    await initCamera();

    monitoringIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current || !detectorRef.current || !mountedRef.current) {
        return;
      }

      try {
        const result = await detectorRef.current.detect(videoRef.current);

        // Motion detection
        if (result.motionDetected && !motionStateRef.current.isDetected) {
          console.log('[Security Monitor] Motion detected!');
          motionStateRef.current.isDetected = true;
          setLastMotionDetected(true);
          
          if (!motionStateRef.current.alertSent) {
            await handleMotionDetection();
            motionStateRef.current.alertSent = true;
          }
        } else if (!result.motionDetected && motionStateRef.current.isDetected) {
          motionStateRef.current.isDetected = false;
          motionStateRef.current.alertSent = false;
          setLastMotionDetected(false);
        }

        // Face detection
        if (result.faceDetected && !faceStateRef.current.isDetected) {
          console.log('[Security Monitor] Face detected!');
          faceStateRef.current.isDetected = true;
          setLastFaceDetected(true);
          
          if (!faceStateRef.current.alertSent) {
            await handleFaceDetection();
            faceStateRef.current.alertSent = true;
          }
        } else if (!result.faceDetected && faceStateRef.current.isDetected) {
          faceStateRef.current.isDetected = false;
          faceStateRef.current.alertSent = false;
          setLastFaceDetected(false);
        }

      } catch (error) {
        console.error('[Security Monitor] Detection error:', error);
      }
    }, 1000); // Check every second
  };

  const stopMonitoring = () => {
    console.log('[Security Monitor] Stopping monitoring...');
    
    if (monitoringIntervalRef.current) {
      clearInterval(monitoringIntervalRef.current);
      monitoringIntervalRef.current = null;
    }

    motionStateRef.current = { isDetected: false, alertSent: false };
    faceStateRef.current = { isDetected: false, alertSent: false };
    setLastMotionDetected(false);
    setLastFaceDetected(false);
    
    if (detectorRef.current) {
      detectorRef.current.reset();
    }
    
    cleanup();
  };

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const sendAlertToBackend = async (
    detectionType: 'motion' | 'face',
    imageBase64: string,
    makeCall: boolean // New parameter to control call behavior
  ): Promise<{ success: boolean; email_sent: boolean; call_made: boolean }> => {
    try {
      console.log(`[Security Monitor] Sending ${detectionType} alert to backend (makeCall: ${makeCall})...`);

      const response = await fetch(`${BACKEND_URL}/send-alert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: detectionType,
          image: imageBase64,
          timestamp: new Date().toISOString(),
          kiosk_id: kioskId,
          make_call: makeCall // Tell backend whether to make a call
        })
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const data = await response.json();
      console.log('[Security Monitor] Backend response:', data);

      return {
        success: data.success || false,
        email_sent: data.email_sent || false,
        call_made: data.call_made || false
      };

    } catch (error) {
      console.error('[Security Monitor] Failed to send alert to backend:', error);
      return {
        success: false,
        email_sent: false,
        call_made: false
      };
    }
  };

  const handleMotionDetection = async () => {
    console.log('[Security Monitor] Handling motion detection...');

    try {
      // Check if we should make a call based on cooldown period
      const now = Date.now();
      const timeSinceLastCall = now - lastMotionCallTimeRef.current;
      const shouldMakeCall = timeSinceLastCall >= CALL_COOLDOWN_MS;
      
      if (!shouldMakeCall) {
        console.log(`[Security Monitor] Motion call skipped - cooldown active (${Math.round(timeSinceLastCall / 1000)}s since last call, need ${CALL_COOLDOWN_MS / 1000}s)`);
      }

      let imageBase64 = '';
      let imageUrl: string | undefined = undefined;
      
      if (videoRef.current) {
        const imageBlob = await captureImageFromVideo(videoRef.current);
        
        if (imageBlob) {
          imageBase64 = await blobToBase64(imageBlob);
          imageUrl = await uploadSecurityImage(imageBlob, kioskId, 'motion') || undefined;
        }
      }

      // Send alert to backend - email will always be sent, call only if cooldown expired
      const alertResult = await sendAlertToBackend('motion', imageBase64, shouldMakeCall);

      // If a call was successfully made, update the last call time
      if (alertResult.call_made) {
        lastMotionCallTimeRef.current = now;
        console.log('[Security Monitor] Motion call made - cooldown started');
      }

      await storeSecurityEvent({
        kiosk_id: kioskId,
        detection_type: 'motion',
        image_url: imageUrl,
        email_sent: alertResult.email_sent,
        call_made: alertResult.call_made
      });

      await updateLastDetectionTime(kioskId, 'motion');
      await updateSirenState(kioskId, true);

      console.log('[Security Monitor] Motion detection handled successfully');

    } catch (error) {
      console.error('[Security Monitor] Failed to handle motion detection:', error);
    }
  };
  const handleFaceDetection = async () => {
    console.log('[Security Monitor] Handling face detection...');

    try {
      // Check if we should make a call based on cooldown period
      const now = Date.now();
      const timeSinceLastCall = now - lastFaceCallTimeRef.current;
      const shouldMakeCall = timeSinceLastCall >= CALL_COOLDOWN_MS;
      
      if (!shouldMakeCall) {
        console.log(`[Security Monitor] Face call skipped - cooldown active (${Math.round(timeSinceLastCall / 1000)}s since last call, need ${CALL_COOLDOWN_MS / 1000}s)`);
      }

      let imageBase64 = '';
      let imageUrl: string | undefined = undefined;
      
      if (videoRef.current) {
        const imageBlob = await captureImageFromVideo(videoRef.current);
        
        if (imageBlob) {
          imageBase64 = await blobToBase64(imageBlob);
          imageUrl = await uploadSecurityImage(imageBlob, kioskId, 'face') || undefined;
        }
      }

      // Send alert to backend - email will always be sent, call only if cooldown expired
      const alertResult = await sendAlertToBackend('face', imageBase64, shouldMakeCall);

      // If a call was successfully made, update the last call time
      if (alertResult.call_made) {
        lastFaceCallTimeRef.current = now;
        console.log('[Security Monitor] Face call made - cooldown started');
      }

      await storeSecurityEvent({
        kiosk_id: kioskId,
        detection_type: 'face',
        image_url: imageUrl,
        email_sent: alertResult.email_sent,
        call_made: alertResult.call_made
      });

      await updateLastDetectionTime(kioskId, 'face');
      await updateSirenState(kioskId, true);

      console.log('[Security Monitor] Face detection handled successfully');

    } catch (error) {
      console.error('[Security Monitor] Failed to handle face detection:', error);
    }
  };
  const playSiren = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(err => {
        console.error('[Security Monitor] Failed to play siren:', err);
      });
    }
  };

  const stopSiren = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const handleStopSiren = async () => {
    console.log('[Security Monitor] Stopping siren...');
    await updateSirenState(kioskId, false);
  };

  // This component runs completely hidden - all UI is shown by SecurityBlackScreen
  // The monitoring and detection happens in the background
  return null;
}