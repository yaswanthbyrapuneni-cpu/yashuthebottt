import { FaceLandmarkerResult, HandLandmarkerResult, NormalizedLandmark, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DetectorType, loadDetector, runDetection } from "../detectors/DetectorManager";
import { supabase } from "../integrations/supabase/client";
import { getJewelryPlacement, JewelryType } from "../utils/jewelry-positioner";
import { calculateDominantEmotion, useEmotionDetection } from "../utils/useemotiondetection";
import { trackTryOnEvent } from "../utils/visitor-tracking";
import { EmotionValidationPopup } from "./EmotionValidationPopup";

// Function to check if an ear is visible based on landmark visibility and face angle
function checkEarVisibility(landmarks: NormalizedLandmark[], side: 'left' | 'right'): boolean {
  // Ear landmark indices
  const earTopIndex = side === 'left' ? 132 : 361;
  const earBottomIndex = side === 'left' ? 177 : 401;
  const noseIndex = 1;  // Nose tip landmark
  
  const earTop = landmarks[earTopIndex];
  const earBottom = landmarks[earBottomIndex];
  const noseTip = landmarks[noseIndex];

  if (!earTop || !earBottom || !noseTip) {
    return false;
  }

  // Check if ear landmarks are present
  if (!earTop.hasOwnProperty('x') || !earBottom.hasOwnProperty('x')) {
    return false;
  }

  // Calculate visibility based on relative position to nose
  const earX = (earTop.x + earBottom.x) / 2;
  if (side === 'left') {
    return earX < noseTip.x; // Left ear should be to the left of nose
  } else {
    return earX > noseTip.x; // Right ear should be to the right of nose
  }
}

interface VirtualTryOnProps {
  isOpen: boolean;
  onClose: () => void;
  productId: number;
  productImage: string;
  productName: string;
  jewelryType: JewelryType;
  detectorType: DetectorType;
}

export function VirtualTryOn({ isOpen, onClose, productId, productImage, productName, jewelryType, detectorType }: VirtualTryOnProps) {
  // Refs for performance-critical values and cleanup
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const hasTrackedRef = useRef(false);
  
  // State that shouldn't trigger parent re-renders
  const [jewelryImage, setJewelryImage] = useState<HTMLImageElement | null>(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDetectorReady, setIsDetectorReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);

  // State for validation popup
  const [showValidationPopup, setShowValidationPopup] = useState(false);
  const [validationData, setValidationData] = useState<{
    samples: any[];
    productName: string;
    emotionPercentages: Record<string, number>;
    uniqueEmotionCount: number;
  } | null>(null);

  // ✅ Handler for when session ends (user closes modal)
  const handleSessionEnd = async (samples: any[], productId: string, productName: string) => {
    console.log('[VTO] 🎯 handleSessionEnd CALLED!');
    console.log('[VTO] 📊 Session ended for', productName, 'with', samples.length, 'samples');
    console.log('[VTO] Samples data:', samples);
    
    if (samples.length === 0) {
      console.log('[VTO] ⚠️ No samples collected, skipping popup');
      return;
    }
    
    // Calculate emotion percentages
    console.log('[VTO] Calculating dominant emotion...');
    const { dominantEmotion, emotionCounts, totalSamples } = calculateDominantEmotion(samples);
    
    const emotionPercentages: Record<string, number> = {};
    Object.entries(emotionCounts).forEach(([emotion, count]) => {
      emotionPercentages[emotion] = Math.round((count / totalSamples) * 100);
    });
    
    const uniqueEmotionCount = Object.keys(emotionCounts).length;
    
    console.log('[VTO] Dominant emotion:', dominantEmotion);
    console.log('[VTO] Emotion percentages:', emotionPercentages);
    console.log('[VTO] Unique emotions detected:', uniqueEmotionCount);
    console.log('[VTO] 🎉 Showing validation popup...');
    
    // Show validation popup - will save to DB when user responds
    setValidationData({ 
      samples, 
      productName, 
      emotionPercentages,
      uniqueEmotionCount 
    });
    setShowValidationPopup(true);
  };

  // ✅ Handler for validation confirmation - saves to simplified DB
  // Can receive either boolean (for 1-2 emotions) or emotion string (for 3 emotions)
  const handleValidationConfirm = async (response: boolean | string) => {
    if (!validationData) return;
    
    const { dominantEmotion, emotionCounts } = calculateDominantEmotion(validationData.samples);
    const uniqueEmotionCount = Object.keys(emotionCounts).length;
    
    let emotionToSave: string;
    let feedbackToSave: string | boolean;
    
    if (uniqueEmotionCount >= 3) {
      // Scenario 2: 3 emotions detected - save user's selected emotion
      emotionToSave = dominantEmotion; // Save AI detected dominant emotion
      feedbackToSave = response as string; // Save user's selected emotion (e.g., "happy", "neutral", "sad")
      console.log('[VTO] User selected emotion:', feedbackToSave, '(AI detected:', dominantEmotion + ')');
    } else if (uniqueEmotionCount === 2) {
      // Scenario 1b: 2 emotions detected
      emotionToSave = dominantEmotion;
      
      if (response === true) {
        // User clicked "Yes" - store "true"
        feedbackToSave = true;
        console.log('[VTO] User validation answer: YES - Accurate');
      } else {
        // User clicked "No" - store the OTHER emotion (secondary)
        const emotions = Object.keys(emotionCounts);
        const secondaryEmotion = emotions.find(e => e !== dominantEmotion);
        feedbackToSave = secondaryEmotion || 'false'; // Fallback to 'false' if no secondary
        console.log('[VTO] User disagreed. Storing secondary emotion:', feedbackToSave);
      }
    } else {
      // Scenario 1a: 1 emotion detected - boolean Yes/No feedback
      emotionToSave = dominantEmotion;
      feedbackToSave = response as boolean; // True = Yes, False = No
      console.log('[VTO] User validation answer:', feedbackToSave ? 'YES - Accurate' : 'NO - Inaccurate');
    }
   // Calculate emotion percentages for storage
    // Calculate emotion percentages for storage
    const dbemotionCounts: Record<string, number> = {};
    validationData.samples.forEach(sample => {
      const emotion = sample.emotion?.toLowerCase() || 'neutral';
      dbemotionCounts[emotion] = (dbemotionCounts[emotion] || 0) + 1;  // ✅ Fixed
    });

    const totalSamples = validationData.samples.length;
    const happyPercentage = Math.round(((dbemotionCounts.happy || 0) / totalSamples) * 100);  // ✅ Fixed
    const neutralPercentage = Math.round(((dbemotionCounts.neutral || 0) / totalSamples) * 100);  // ✅ Fixed
    const sadPercentage = Math.round(((dbemotionCounts.sad || 0) / totalSamples) * 100);  // ✅ Fixed  
    // Save to emotion_analytics table
    try {
      const { error } = await supabase
        .from('emotion_analytics')
        .insert({
          product_id: productId.toString(),
          dominant_emotion: emotionToSave,
          feedback: feedbackToSave, // String for scenario 2, boolean for scenario 1
          happy_percentage: happyPercentage,
          neutral_percentage: neutralPercentage,
          sad_percentage: sadPercentage,
          total_samples: totalSamples,
        });
      
      if (error) {
        console.error('[VTO] Failed to save analytics:', error);
      } else {
        console.log('[VTO] ✅ Analytics saved successfully');
        console.log('[VTO] Saved data:', { 
          product_id: productId.toString(), 
          dominant_emotion: emotionToSave, 
          feedback: feedbackToSave 
        });
      }
    } catch (err) {
      console.error('[VTO] Analytics save error:', err);
    }
    
    // Close popup AND close modal
    setShowValidationPopup(false);
    setValidationData(null);
    onClose(); // 🔥 NOW close the modal after validation
  };

  // ✅ Emotion detection hook - simplified (no 2-minute logic)
  const { activeWearTime, samplesCollected, getSamples } = useEmotionDetection({
    videoElement: videoRef.current,
    productId: productId.toString(),
    productName: productName,
    isActive: isOpen && hasCamera && !isLoading,
    faceDetected: faceDetected,
    onSessionEnd: handleSessionEnd,
  });

  // --- HOOK 1: Load the correct detector model when the modal opens ---
  useEffect(() => {
    if (isOpen) {
      console.log('[VTO] Loading detector:', detectorType);
      setIsLoading(true);
      setIsDetectorReady(false);
      loadDetector(detectorType)
        .then(() => {
          console.log('[VTO] Detector loaded successfully');
          setIsDetectorReady(true);
        })
        .catch(error => {
          console.error('[VTO] Detector loading failed:', error);
          setCameraError(`Failed to load the ${detectorType} model.`);
          setIsLoading(false);
        });
    }
  }, [isOpen, detectorType]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Clean up resources
      stopCamera();
    };
  }, []);

  // --- HOOK 2: Preload the jewelry image ---
  useEffect(() => {
    if (!isOpen) {
      setJewelryImage(null);
      return;
    }

    if (!productImage) {
      console.warn('[VTO] No product image provided');
      setCameraError("No jewelry image available.");
      setIsLoading(false);
      return;
    }

    // Convert relative path to public path if needed
    const publicPath = productImage.startsWith('/') 
      ? productImage 
      : `/public${productImage}`;

    if (!mountedRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous'; // Enable CORS for image loading
    
    img.onload = () => {
      if (mountedRef.current) {
        setJewelryImage(img);
      }
    };
    
    img.onerror = () => {
      if (mountedRef.current) {
        setCameraError("Could not load the jewelry image.");
        setIsLoading(false);
      }
    };
    
    img.src = publicPath;

    return () => {
      if (!mountedRef.current && img.src) {
        img.src = '';  // Cancel the image load
      }
    };
  }, [isOpen, productImage]);

  // Camera initialization with timeout
  useEffect(() => {
    if (!isOpen || !isDetectorReady || !jewelryImage) return;

    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    async function initCamera() {
      try {
        if (!mountedRef.current) return;

        // Set 10 second timeout
        timeoutId = setTimeout(() => {
          if (isMounted && mountedRef.current) {
            setCameraError("Camera initialization timeout. Please try again.");
            setIsLoading(false);
          }
        }, 10000);

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          }
        });

        if (!isMounted || !mountedRef.current) {
          mediaStream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = mediaStream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play();
          
          console.log('[VTO] Stream Resolution:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);

          if (isMounted && mountedRef.current) {
            clearTimeout(timeoutId);
            setHasCamera(true);
            setIsLoading(false);

            //Track try on event once per session
            if (!hasTrackedRef.current) {
              trackTryOnEvent(productId, productName, jewelryType, productImage);
              hasTrackedRef .current = true;
            }
            requestRef.current = requestAnimationFrame(predictWebcam);
          }
        }
      } catch (err) {
        if (isMounted && mountedRef.current) {
          clearTimeout(timeoutId);
          setIsLoading(false);
          setHasCamera(false);
          setCameraError(err instanceof Error ? err.message : "Failed to access camera");
        }
      }
    }

    initCamera();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = 0;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [isOpen, isDetectorReady, jewelryImage]);

  const predictWebcam = () => {
    // Return early if component is unmounted
    if (!mountedRef.current) return;

    const now = performance.now();
    const timeSinceLastFrame = now - lastFrameTimeRef.current;
    
    // Throttle to 30fps (33ms per frame) for better performance
    if (timeSinceLastFrame < 60) {
      requestRef.current = requestAnimationFrame(predictWebcam);
      return;
    }
    
    lastFrameTimeRef.current = now;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    
    if (!video || !canvas || !ctx || !jewelryImage || video.readyState < 2) {
      requestRef.current = requestAnimationFrame(predictWebcam);
      return;
    }
    
    // Update canvas dimensions if needed
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    
    // Run detection and get results
    const results = runDetection(detectorType, video);
    
    // Draw video frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    let currentlyDetected = false;
    
    if (results) {
      // Handle different result structures from MediaPipe models
      let landmarks = null;
      
      if (detectorType === 'face') {
        const faceResults = results as FaceLandmarkerResult;
        if (faceResults.faceLandmarks?.[0]) {
          landmarks = faceResults.faceLandmarks[0];
          currentlyDetected = true;
        }
      } else if (detectorType === 'hands') {
        const handResults = results as HandLandmarkerResult;
        if (handResults.landmarks?.[0]) {
          landmarks = handResults.landmarks[0];
          currentlyDetected = true;
        }
      } else if (detectorType === 'pose') {
        const poseResults = results as PoseLandmarkerResult;
        if (poseResults.landmarks?.[0]) {
          landmarks = poseResults.landmarks[0];
          currentlyDetected = true;
        }
      }
      
      setFaceDetected(currentlyDetected);
      
      if (landmarks) {
        // Normalize jewelry type
        const normalizedType = jewelryType?.toUpperCase?.();

        // Special handling for earrings - draw on both ears
        if (normalizedType === 'EARRINGS' || jewelryType === 'earring-left' || jewelryType === 'earrings') {
          // Check if ears are visible based on landmark positions
          const leftEarVisible = checkEarVisibility(landmarks, 'left');
          const rightEarVisible = checkEarVisibility(landmarks, 'right');

          // Only get placement for visible ears
          const leftPlacement = leftEarVisible ? getJewelryPlacement('earring-left', landmarks, canvas, jewelryImage) : null;
          const rightPlacement = rightEarVisible ? getJewelryPlacement('earring-right', landmarks, canvas, jewelryImage) : null;

          if (leftPlacement && leftEarVisible) {
            ctx.drawImage(jewelryImage, leftPlacement.x, leftPlacement.y, leftPlacement.width, leftPlacement.height);
          }
          if (rightPlacement && rightEarVisible) {
            ctx.drawImage(jewelryImage, rightPlacement.x, rightPlacement.y, rightPlacement.width, rightPlacement.height);
          }
        } else {
          const placement = getJewelryPlacement(jewelryType, landmarks, canvas, jewelryImage);
          if (placement) {
            // Handle array of placements for bangles
            if (Array.isArray(placement)) {
              placement.forEach(p => {
                ctx.save();
                // Apply rotation if available
                if (p.rotation) {
                  const centerX = p.x + p.width / 2;
                  const centerY = p.y + p.height / 2;
                  ctx.translate(centerX, centerY);
                  ctx.rotate(p.rotation);
                  ctx.translate(-centerX, -centerY);
                }
                ctx.drawImage(jewelryImage, p.x, p.y, p.width, p.height);
                ctx.restore();
              });
            } else {
              // Apply specific adjustments for chains
              if (jewelryType === 'CHAINS') {
                ctx.save();
                ctx.filter = 'brightness(1.1) contrast(1.2)';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
                ctx.shadowBlur = 5;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
                ctx.drawImage(jewelryImage, placement.x, placement.y, placement.width, placement.height);
                ctx.restore();
              } else {
                ctx.drawImage(jewelryImage, placement.x, placement.y, placement.width, placement.height);
              }
            }
          }
        }
      }
    } else {
      setFaceDetected(false);
    }
    
    requestRef.current = requestAnimationFrame(predictWebcam);
  };
  
  const startCamera = async () => {
    console.log('[VTO] Starting camera initialization');
    setCameraError("");
    try {
      console.log('[VTO] Requesting camera access');
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "user",
          frameRate: { ideal: 30 }
        } 
      });
      console.log('[VTO] Camera access granted');

      if (!mountedRef.current) {
        mediaStream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = mediaStream;
      
      const video = videoRef.current;
      if (video) {
        video.srcObject = mediaStream;
        await video.play();

        if (mountedRef.current) {
          setHasCamera(true);
          setIsLoading(false);
          requestRef.current = requestAnimationFrame(predictWebcam);
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setIsLoading(false);
        setHasCamera(false);
        if (err instanceof Error) {
          if (err.name === 'NotAllowedError') setCameraError("Camera permission denied.");
          else if (err.name === 'NotFoundError') setCameraError("No camera found.");
          else setCameraError("Unable to access camera.");
        }
      }
    }
  };

  const stopCamera = () => {
    console.log('[VTO] Stopping camera and cleaning up');
    
    // Cancel animation frame
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = 0;
    }
    
    // Stop all tracks and clear stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
        console.log('[VTO] Stopped track:', track.kind);
      });
      streamRef.current = null;
    }
    
    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    
    // Reset all states
    setIsLoading(true);
    setHasCamera(false);
    setIsDetectorReady(false);
    setFaceDetected(false);
    lastFrameTimeRef.current = 0;
    
    console.log('[VTO] Cleanup completed');
  };

  // 🔥 FIX: Handle close button - get samples BEFORE cleanup
  const handleClose = () => {
    console.log('[VTO] 🚪 Close button clicked');
    
    // Get samples BEFORE any cleanup
    if (getSamples) {
      const samples = getSamples();
      console.log('[VTO] 📊 Retrieved', samples.length, 'samples before closing');
      
      if (samples.length > 0) {
        console.log('[VTO] 🎯 Triggering session end with samples');
        // Trigger session end which will show the validation popup
        handleSessionEnd(samples, productId.toString(), productName);
        // Clean up camera but DON'T close modal yet - wait for validation
        stopCamera();
        return; // Don't call onClose() - validation popup will handle it
      }
    }
    
    // No samples, close normally
    console.log('[VTO] No samples to validate, closing normally');
    stopCamera();
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="relative w-11/12 aspect-[3/4] bg-[#fcf5f1] rounded-3xl overflow-hidden shadow-2xl">
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-6 bg-gradient-to-b from-black/50 to-transparent">
            <div>
              <h2 className="font-['Playfair_Display'] text-white text-3xl">Virtual Try-On</h2>
              <p className="font-['Montserrat'] text-white/80 text-sm mt-1">{productName}</p>
            </div>
            <button 
              onClick={handleClose}
              className="p-3 rounded-full bg-white/20 backdrop-blur-md hover:bg-white/30 transition-colors"
            >
              <X className="w-6 h-6 text-white" />
            </button>
          </div>

          {/* Debug Overlay */}
          {hasCamera && !isLoading && (
            <div className="absolute bottom-4 left-4 z-20 bg-black/70 text-white text-xs p-3 rounded-lg font-mono">
              <div>Face: {faceDetected ? '✅' : '❌'}</div>
              <div>Time: {activeWearTime}s</div>
              <div>Samples: {samplesCollected}</div>
            </div>
          )}

          <div className="relative w-full h-full flex items-center justify-center">
            <video ref={videoRef} autoPlay playsInline muted className="hidden" />
            {isLoading && (
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-[#7c563d] border-t-transparent" />
                <p className="font-['Montserrat'] text-[#7c563d] text-center px-8">
                  {isDetectorReady ? "Starting camera..." : "Loading AI model..."}
                </p>
              </div>
            )}
            {!isLoading && hasCamera && (
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
            )}
            {!isLoading && !hasCamera && (
              <div className="flex flex-col items-center justify-center gap-6 max-w-md">
                <Camera className="w-24 h-24 text-[#7c563d]/30" />
                <div className="text-center space-y-2">
                  <p className="font-['Montserrat'] text-[#7c563d] font-medium text-lg">{cameraError || "Camera access required"}</p>
                  <p className="font-['Montserrat'] text-[#7c563d]/70 text-sm px-8">Please allow camera access to try on jewelry virtually.</p>
                </div>
                <button onClick={startCamera} className="px-6 py-3 bg-[#7c563d] text-white rounded-full font-['Montserrat'] font-medium hover:bg-[#6a4a33] transition-colors">
                  Enable Camera
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Validation Popup */}
      {showValidationPopup && validationData && (
        <EmotionValidationPopup
          isOpen={showValidationPopup}
          productName={validationData.productName}
          samples={validationData.samples}
          emotionPercentages={validationData.emotionPercentages}
          uniqueEmotionCount={validationData.uniqueEmotionCount}
          onConfirm={handleValidationConfirm}
        />
      )}
    </>
  );
}